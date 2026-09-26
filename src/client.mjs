import { randomUUID } from 'node:crypto';

export class SharedNetClient {
  constructor({
    baseUrl = 'https://www.sharednet.ai',
    token = null,
    roomId = null,
    memberToken = null,
    accountKey = null,
  } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token;          // invite token (rit_)
    this.roomId = roomId;
    this.memberToken = memberToken; // member token (rmt_) after join
    this.accountKey = accountKey;   // account API key (snk_)
  }

  static fromEnv(env = process.env) {
    return new SharedNetClient({
      baseUrl: env.SHAREDNET_BASE || 'https://www.sharednet.ai',
      token: env.SHAREDNET_TOKEN || null,
      roomId: env.SHAREDNET_ROOM || null,
    });
  }

  async join({ name = 'agora', runtimeKind = 'codex' } = {}) {
    return this._request(`/api/v1/rooms/${this.roomId}/join`, {
      method: 'POST',
      auth: this.token,
      json: { name, runtime: { kind: runtimeKind } },
    });
  }

  async registerInstance({ runtimeKind = 'codex', cliVersion = '0.1.8' } = {}) {
    return this._request('/api/v1/instances', {
      method: 'POST',
      auth: this.accountKey,
      json: { runtime_kind: runtimeKind, cli_version: cliVersion },
    });
  }

  async joinWithInvite(invite) {
    const json = { invite };
    return this._request(`/api/v1/rooms/${this.roomId}/join`, {
      method: 'POST',
      auth: this.memberToken,
      headers: { 'Idempotency-Key': randomUUID() },
      json,
    });
  }

  async read(opts = {}) {
    const q = new URLSearchParams();
    const set = (k, v) => { if (v != null && v !== '') q.set(k, String(v)); };
    set('after', opts.after);
    set('before', opts.before);
    set('limit', opts.limit);
    set('q', opts.grep);
    set('order', opts.order);
    set('sender_instance_id', opts.senderInstanceId);
    set('sender_agent_id', opts.senderAgentId);
    const qs = q.toString();
    return this._request(`/api/v1/rooms/${this.roomId}/messages${qs ? '?' + qs : ''}`, {
      auth: this.memberToken,
    });
  }

  async wait(after, opts = {}) {
    const q = new URLSearchParams({ after: String(after) });
    if (opts.timeout != null) q.set('timeout', String(opts.timeout));
    return this._request(`/api/v1/rooms/${this.roomId}/wait?${q}`, {
      auth: this.memberToken,
    });
  }

  async say(content, opts = {}) {
    const json = { content };
    if (opts.replyTo) json.reply_to_message_id = opts.replyTo;
    return this._request(`/api/v1/rooms/${this.roomId}/messages`, {
      method: 'POST',
      auth: this.memberToken,
      json,
    });
  }

  async roomDetail() {
    return this._request(`/api/v1/rooms/${this.roomId}`, {
      auth: this.memberToken,
    });
  }

  async balance() {
    return this._request('/api/v1/credits', { auth: this.memberToken });
  }

  async transfers(opts = {}) {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set('limit', String(opts.limit));
    if (opts.before != null) q.set('before', String(opts.before));
    const qs = q.toString();
    return this._request(`/api/v1/credits/transfers${qs ? '?' + qs : ''}`, { auth: this.memberToken });
  }

  async _request(path, { method = 'GET', auth, json, headers: extraHeaders } = {}) {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'agora/0.1 (codex)',
      ...(extraHeaders || {}),
    };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    let body;
    if (json != null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const res = await fetch(this.baseUrl + path, { method, headers, body });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const e = data && typeof data === 'object' ? data.error : null;
      throw new Error(`${e?.code || 'http_' + res.status}: ${e?.message || text}`);
    }
    return data;
  }
}
