declare module "web-push" {
  export interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }

  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(
      subscription: {
        endpoint: string;
        expirationTime?: number | null;
        keys: { p256dh: string; auth: string };
      },
      payload?: string | Buffer,
      options?: { TTL?: number; urgency?: "very-low" | "low" | "normal" | "high" },
    ): Promise<SendResult>;
  };

  export default webpush;
}
