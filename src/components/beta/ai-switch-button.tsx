'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText, postJson } from './forms';

/** Pauses or resumes AI reports for every account; takes effect immediately. */
export function AiSwitchButton({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const toggle = async () => {
    setPending(true);
    const r = await postJson('/api/beta/admin/ai', { paused: !paused });
    setPending(false);
    if (!r.ok) return toast.error(errorText(r, 'Could not change the AI setting.'));
    toast.success(paused ? 'AI reports resumed.' : 'AI reports paused for every account.');
    router.refresh();
  };
  return (
    <Button variant={paused ? 'default' : 'destructive'} onClick={toggle} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : paused ? <PlayCircle /> : <PauseCircle />}
      {paused ? 'Resume AI reports' : 'Pause AI reports'}
    </Button>
  );
}
