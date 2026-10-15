import { lifecycleRequest } from '@/lib/saas/lifecycle-http';
export const POST = (request: Request) => lifecycleRequest(request, 'export');
