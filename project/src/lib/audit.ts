export async function logAudit(
  action: string,
  entityType: string,
  entityId: string | null,
  description: string,
  oldValues?: Record<string, unknown> | null,
  newValues?: Record<string, unknown> | null,
) {
  // Mutations are audited by database triggers in the same transaction.
  void action; void entityType; void entityId; void description; void oldValues; void newValues;
}
