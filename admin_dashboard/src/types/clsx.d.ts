declare module 'clsx' {
  export type ClassValue =
    | string
    | number
    | null
    | boolean
    | undefined
    | ClassDictionary
    | ClassArray;

  export interface ClassDictionary {
    [id: string]: any;
  }

  export interface ClassArray extends Array<ClassValue> {}

  export function clsx(...inputs: ClassValue[]): string;
  export default clsx;
}
