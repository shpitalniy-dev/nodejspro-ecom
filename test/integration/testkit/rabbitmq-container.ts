import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { RabbitMQContainer } from '@testcontainers/rabbitmq';

export interface TestBroker {
  url: string;
  stop(): Promise<void>;
}

// One real RabbitMQ per test file, the same image docker-compose.yml runs.
// Its own container, so a test can declare and delete topology freely.
export async function startTestRabbitMQ(): Promise<TestBroker> {
  const container: StartedRabbitMQContainer = await new RabbitMQContainer(
    'rabbitmq:4.2-management',
  ).start();

  return {
    url: container.getAmqpUrl(),
    stop: () => container.stop().then(() => undefined),
  };
}
