export function DemoVideo({ id }: { id: string }) {
  return (
    <video
      src={`/demos/${id}.webm`}
      autoPlay
      loop
      muted
      playsInline
      style={{ borderRadius: "8px", border: "1px solid #333" }}
    />
  );
}
