// Example Supabase Edge Function

Deno.serve(async (req) => {
  const { name } = await req.json();

  const data = {
    message: `Hello ${name || "World"}!`,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
});
