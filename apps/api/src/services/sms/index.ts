import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

/**
 * Provider-agnostic SMS.
 *
 * Same shape as the payment service: the MVP ships a console implementation, and
 * a real gateway (Unifonic, Twilio) drops in behind this interface without any
 * caller changing. Saudi SMS also requires a registered sender ID, which is a
 * procurement task, not a code one — so the seam matters more than the provider.
 */
export interface SmsMessage {
  /** E.164. */
  to: string;
  body: string;
}

export interface SmsSendResult {
  providerMessageId: string;
  provider: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

/** Logs the message instead of sending it. The OTP flow is fully testable on this. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  async send(message: SmsMessage): Promise<SmsSendResult> {
    logger.info({ to: message.to, body: message.body }, '[sms:console] message not actually sent');
    return {
      provider: this.name,
      providerMessageId: `console_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}

let instance: SmsProvider | null = null;

export function smsProvider(): SmsProvider {
  if (instance) return instance;

  switch (env().SMS_PROVIDER) {
    case 'console':
    default:
      instance = new ConsoleSmsProvider();
  }

  return instance;
}

/** Test seam — swap in a spy without touching env. */
export function setSmsProvider(provider: SmsProvider | null): void {
  instance = provider;
}
