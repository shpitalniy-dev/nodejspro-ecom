// Never Order-specific in substance — every outbox-relay consumer only
// ever reads type/eventId/occurredAt off it, regardless of which aggregate
// or sink the event is actually bound for.
export interface PublishableEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  [key: string]: unknown;
}
