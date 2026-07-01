export interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}
