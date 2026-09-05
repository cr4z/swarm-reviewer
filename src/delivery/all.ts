// Side-effect module: importing this registers every delivery channel (pr-comment, email)
// and every email provider adapter (resend).
import { registerChannel } from "./registry.js";
import { prCommentChannel } from "./pr-comment.js";
import { emailChannel } from "./email.js";
import { registerEmailProvider } from "./email-providers/registry.js";
import { resendAdapter } from "./email-providers/resend.js";

registerChannel(prCommentChannel);
registerChannel(emailChannel);
registerEmailProvider(resendAdapter);
