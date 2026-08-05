import { createApp } from "./app";
import { processCreationDraftQueue, type CreationDraftQueueMessage } from "./creation-draft-jobs";
import { defaultCreationProvider } from "./creation-drafts";
import type { Bindings } from "./env";

const app = createApp();

const worker = {
  fetch: app.fetch.bind(app),
  request: app.request.bind(app),
  async queue(batch: MessageBatch<CreationDraftQueueMessage>, env: Bindings): Promise<void> {
    await processCreationDraftQueue(batch, env, {
      now: () => new Date(),
      createCreationProvider: defaultCreationProvider,
    });
  },
};

export { createApp } from "./app";
export type { Bindings } from "./env";
export default worker;
