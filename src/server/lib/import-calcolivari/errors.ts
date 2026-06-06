export class ImportError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
