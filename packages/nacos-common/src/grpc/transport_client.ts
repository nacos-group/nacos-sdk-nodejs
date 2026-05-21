import * as crypto from 'crypto';
import { GrpcConnection } from './connection';
import { PayloadCodec } from './payload_codec';

const DEFAULT_TIMEOUT_MS = 3000;

function generateRequestId(): string {
  const bytes = crypto.randomBytes(16);
  // Format as UUID v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timer;
}

export class GrpcTransportClient {
  private connection: GrpcConnection;
  private codec: PayloadCodec;
  private pending: Map<string, PendingRequest> = new Map();

  constructor(connection: GrpcConnection) {
    this.connection = connection;
    this.codec = new PayloadCodec();

    // Listen for bi-stream responses (those not handled by server push handlers)
    this.connection.on('payload', (decoded: { type: string; body: any }) => {
      this.handlePayload(decoded);
    });
  }

  private handlePayload(decoded: { type: string; body: any }): void {
    const { body } = decoded;
    const requestId: string | undefined = body && body.requestId;
    if (!requestId) return;

    const pending = this.pending.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer as any);
    this.pending.delete(requestId);

    if (decoded.type === 'ErrorResponse') {
      pending.reject(new Error(
        `ErrorResponse: errorCode=${body.errorCode}, resultCode=${body.resultCode}, message=${body.message || ''}`
      ));
    } else {
      pending.resolve(body);
    }
  }

  async request<Res = any>(message: any, requestType: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Res> {
    const requestId = generateRequestId();
    const payload = this.codec.encode({ ...message, requestId }, requestType, this.connection.getAuthHeaders());

    const responsePayload = await this.connection.request(payload);
    const decoded = this.codec.decode(responsePayload);

    if (decoded.type === 'ErrorResponse') {
      throw new Error(
        `ErrorResponse: errorCode=${decoded.body.errorCode}, resultCode=${decoded.body.resultCode}, message=${decoded.body.message || ''}`
      );
    }

    return decoded.body as Res;
  }

  async streamRequest<Res = any>(message: any, requestType: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Res> {
    const requestId = generateRequestId();
    const payload = this.codec.encode({ ...message, requestId }, requestType, this.connection.getAuthHeaders());

    return new Promise<Res>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`streamRequest timed out after ${timeoutMs}ms for type=${requestType}, requestId=${requestId}`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      try {
        this.connection.streamWrite(payload);
      } catch (e) {
        clearTimeout(timer as any);
        this.pending.delete(requestId);
        reject(e);
      }
    });
  }

  registerServerPushHandler(type: string, handler: (request: any) => any): void {
    this.connection.onServerPush(type, handler);
  }

  removeServerPushHandler(type: string): void {
    this.connection.removeServerPushHandler(type);
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  onReconnect(callback: () => void): void {
    this.connection.on('reconnected', callback);
  }
}
