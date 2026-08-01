import { z } from 'zod';
import { localeField, nameField, otpCodeField, passwordField, phoneField } from './common.js';

export const registerSchema = z.object({
  name: nameField,
  phone: phoneField('SA'),
  password: passwordField,
  locale: localeField.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  phone: phoneField('SA'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** OTP request. Rate limited hard — this endpoint costs money per call in production. */
export const otpRequestSchema = z.object({
  phone: phoneField('SA'),
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneField('SA'),
  code: otpCodeField,
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'كلمة المرور الحالية مطلوبة'),
  newPassword: passwordField,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Shape returned to the client on login/register/refresh. Never includes the refresh token. */
export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: 'HOST' | 'ADMIN';
  locale: 'ar' | 'en';
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}
