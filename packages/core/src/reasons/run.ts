// Reason codes of the run family, added to ReasonParams by declaration merging.
export {};

declare module '../reason.ts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- codes come with the family
  interface ReasonParams {}
}
