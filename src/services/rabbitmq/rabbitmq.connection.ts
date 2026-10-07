import type { ChannelModel } from 'amqplib';
import amqp from 'amqplib';

// The 'error' listener is mandatory: without it a dropped socket is an
// unhandled 'error' event and Node exits.
export async function connectBroker(url: string): Promise<ChannelModel> {
  const connection = await amqp.connect(url);

  connection.on('error', error => {
    console.error('[rabbitmq] connection error', error);
  });

  return connection;
}
