/** Consistent REST envelope used by every /api/v1 endpoint. */
export interface ResponseMeta {
  requestId: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
  meta: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;
