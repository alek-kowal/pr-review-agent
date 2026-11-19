// Stand-in for sections whose screens arrive in later slices.
export function PlaceholderPage({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="font-heading text-xl font-semibold">{title}</h1>
      <p className="text-text-3">{text}</p>
    </section>
  );
}
