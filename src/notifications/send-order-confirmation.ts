export const EMAIL_NOTIFICATIONS_QUEUE = 'email.notifications';

export interface SendOrderConfirmation {
  messageId: string;
  orderId: number;
  customerEmail: string;
  // Time the notification command was created, in ISO 8601 format.
  createdAt: string;
}
