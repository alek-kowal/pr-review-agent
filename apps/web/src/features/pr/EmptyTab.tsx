/** A tab with nothing to show yet: one plain sentence. */
export function EmptyTab({ text }: { text: string }) {
  return <p className="py-6 text-text-3">{text}</p>;
}
