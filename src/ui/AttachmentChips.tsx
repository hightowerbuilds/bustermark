import { For, Show } from "solid-js";
import { formatBytes, type ChatAttachment } from "../lib/chat-attachments";

/** Files waiting to go out with the next message, each removable. */
export default function AttachmentChips(props: { attachments: ChatAttachment[]; onRemove: (id: string) => void }) {
  return (
    <ul class="as-attachments" aria-label="Attachments">
      <For each={props.attachments}>{attachment =>
        <li class="as-attachment">
          <Show when={attachment.kind === "image" && attachment} fallback={<span class="as-attachment-icon" aria-hidden="true">TXT</span>}>
            {image => <img src={`data:${image().mimeType};base64,${image().data}`} alt="" />}
          </Show>
          <span class="as-attachment-name" title={attachment.name}>{attachment.name}</span>
          <span class="as-attachment-size">{formatBytes(attachment.bytes)}</span>
          <button type="button" class="as-attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => props.onRemove(attachment.id)}>×</button>
        </li>
      }</For>
    </ul>
  );
}
