import 'server-only';
import {and, eq, sql} from 'drizzle-orm';
import type {SaasDb} from './db';
import * as s from './schema';
import {assertAdministrator} from './administration';

/** Operator-only portability for ONE existing verified administrator. Never copies sessions,
 * invitations, test users, Google grants or domain records from staging. Treat as a secret. */
export type UnifiedOwner = {userId:string; tenantId:string; name:string; email:string; passwordHash:string; accountId:string; credentialId:string};
export async function captureUnifiedOwner(source:SaasDb, email:string):Promise<UnifiedOwner> {
  return source.transaction(async tx=>{
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    const [u]=await tx.select().from(s.user).where(eq(s.user.email,email.trim().toLowerCase()));
    if(!u?.emailVerified)throw Error('Existing verified owner required');
    await assertAdministrator(tx as unknown as SaasDb,u.id);
    const [t]=await tx.select().from(s.tenants).where(and(eq(s.tenants.personalUserId,u.id),eq(s.tenants.status,'active')));
    const [a]=await tx.select().from(s.account).where(and(eq(s.account.userId,u.id),eq(s.account.providerId,'credential')));
    if(!t||!a?.password)throw Error('Active owner and password credential required');
    return {userId:u.id,tenantId:t.id,name:u.name,email:u.email,passwordHash:a.password,accountId:a.accountId,credentialId:a.id};
  });
}

/** New, empty destination only. Operator confirms the exact owner email out of band. */
export async function seedUnifiedOwner(destination:SaasDb, owner:UnifiedOwner, confirmedEmail:string) {
  if(owner.email!==confirmedEmail.trim().toLowerCase()||!owner.userId||!owner.tenantId||!owner.passwordHash)throw Error('Owner confirmation mismatch');
  return destination.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(72104002)`);
    if((await tx.select({id:s.user.id}).from(s.user).limit(1)).length)throw Error('Destination identities must be empty');
    await tx.insert(s.user).values({id:owner.userId,name:owner.name,email:owner.email,emailVerified:true});
    await tx.insert(s.account).values({id:owner.credentialId,accountId:owner.accountId,providerId:'credential',userId:owner.userId,password:owner.passwordHash});
    await tx.insert(s.tenants).values({id:owner.tenantId,name:`${owner.name}'s account`,personalUserId:owner.userId,websiteLimit:20,monthlyAuditLimit:100,monthlyPagespeedLimit:1000,monthlyAiLimit:50});
    await tx.insert(s.memberships).values({tenantId:owner.tenantId,userId:owner.userId,role:'owner'});
    await tx.insert(s.administrators).values({userId:owner.userId});
    return {userId:owner.userId,tenantId:owner.tenantId};
  });
}
