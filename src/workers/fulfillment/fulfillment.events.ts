export type WorkerEvent =
  | 'delivered'
  | 'acked'
  | 'rejected'
  | 'requeued'
  | 'skipped';

// Reports one event to the parent process over Node's IPC channel. That channel
// exists only when a parent started this process with an 'ipc' stdio entry (the
// demos do). In production there is no channel, so this does nothing.
//
// Resolves once the message has been written to the channel. A caller that is
// about to crash waits for it, so the parent still receives the event.
export function recordWorkerEvent(event: WorkerEvent): Promise<void> {
  if (!process.send) {
    return Promise.resolve();
  }

  const send = process.send.bind(process);

  return new Promise(resolve => {
    send({ event }, () => resolve());
  });
}
