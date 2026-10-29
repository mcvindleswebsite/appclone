export interface MailAddress {
  name: string;
  address: string;
}

export interface MailboxInfo {
  path: string;
  name: string;
  /** IMAP special-use flag, e.g. "\\Sent" or "\\Trash"; "\\Inbox" for the inbox. */
  specialUse: string | null;
  unseen: number;
}

export interface MessageSummary {
  uid: number;
  from: MailAddress | null;
  to: MailAddress[];
  subject: string;
  /** ISO date. */
  date: string;
  seen: boolean;
  flagged: boolean;
}

export interface MessageList {
  box: string;
  total: number;
  page: number;
  /** Newest first. */
  messages: MessageSummary[];
}

export interface MessageDetail extends MessageSummary {
  cc: MailAddress[];
  replyTo: MailAddress[];
  html: string | null;
  text: string;
  messageId: string | null;
  references: string[];
  attachments: { filename: string; size: number }[];
}

export interface SendRequest {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}
