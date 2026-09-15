import { supabase } from '@/lib/supabase';

export async function logAudit(
  action: string,
  entityType: string,
  entityId: string | null,
  description: string,
  oldValues?: Record<string, unknown> | null,
  newValues?: Record<string, unknown> | null,
) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  const userName = session?.user?.email || 'Unknown';

  await supabase.from('audit_logs').insert({
    user_id: userId,
    user_name: userName,
    action,
    entity_type: entityType,
    entity_id: entityId,
    description,
    old_values: oldValues || null,
    new_values: newValues || null,
  });
}
