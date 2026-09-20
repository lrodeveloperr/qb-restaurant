import { AppError, invariant } from '../domain/errors.js';

export const QUICKBOOKS_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';
export const QUICKBOOKS_AUTHORIZATION_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QUICKBOOKS_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QUICKBOOKS_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

function basicAuthorization(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

async function jsonOrText(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
}

export class QuickBooksOAuthClient {
  constructor({ clientId, clientSecret, redirectUri, fetchImpl = globalThis.fetch }) {
    invariant(typeof clientId === 'string' && clientId, 'OAUTH_CONFIG_REQUIRED', 'QuickBooks client ID is required.');
    invariant(typeof clientSecret === 'string' && clientSecret, 'OAUTH_CONFIG_REQUIRED', 'QuickBooks client secret is required.');
    invariant(typeof redirectUri === 'string' && redirectUri, 'OAUTH_CONFIG_REQUIRED', 'QuickBooks redirect URI is required.');
    invariant(typeof fetchImpl === 'function', 'OAUTH_CONFIG_REQUIRED', 'A fetch implementation is required.');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.fetch = fetchImpl;
  }

  authorizationUrl({ state }) {
    invariant(typeof state === 'string' && state.length >= 32, 'INVALID_OAUTH_STATE', 'OAuth state must be an unguessable value of at least 32 characters.');
    const url = new URL(QUICKBOOKS_AUTHORIZATION_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: QUICKBOOKS_ACCOUNTING_SCOPE,
      redirect_uri: this.redirectUri,
      state,
    });
    return url.toString();
  }

  exchangeCode(code) {
    invariant(typeof code === 'string' && code, 'INVALID_AUTHORIZATION_CODE', 'Authorization code is required.');
    return this.#tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
  }

  refresh(refreshToken) {
    invariant(typeof refreshToken === 'string' && refreshToken, 'INVALID_REFRESH_TOKEN', 'Refresh token is required.');
    return this.#tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(token) {
    invariant(typeof token === 'string' && token, 'INVALID_TOKEN', 'A refresh or access token is required.');
    const response = await this.fetch(QUICKBOOKS_REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: basicAuthorization(this.clientId, this.clientSecret), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw new AppError('QUICKBOOKS_REVOKE_FAILED', 'QuickBooks authorization could not be revoked.', { status: response.status });
    return true;
  }

  async #tokenRequest(values) {
    const response = await this.fetch(QUICKBOOKS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthorization(this.clientId, this.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(values),
    });
    const body = await jsonOrText(response);
    if (!response.ok) throw new AppError('QUICKBOOKS_OAUTH_FAILED', 'QuickBooks authorization failed.', { status: response.status, error: body.error });
    invariant(typeof body.access_token === 'string' && typeof body.refresh_token === 'string',
      'QUICKBOOKS_OAUTH_INVALID_RESPONSE', 'QuickBooks returned an invalid token response.');
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      accessTokenExpiresInSeconds: Number(body.expires_in),
      refreshTokenExpiresInSeconds: Number(body.x_refresh_token_expires_in),
      tokenType: body.token_type,
    };
  }
}
