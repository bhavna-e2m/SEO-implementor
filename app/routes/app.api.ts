import { authenticate } from "../shopify.server";

export const action = async ({ request }: { request: Request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "graphql") {
    return Response.json({ error: "Unsupported action." }, { status: 400 });
  }

  const query = formData.get("query");
  const variablesRaw = formData.get("variables");

  if (typeof query !== "string" || !query.trim()) {
    return Response.json({ error: "Missing GraphQL query." }, { status: 400 });
  }

  let variables: Record<string, unknown> = {};
  if (typeof variablesRaw === "string" && variablesRaw.trim()) {
    try {
      variables = JSON.parse(variablesRaw) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid variables payload." }, { status: 400 });
    }
  }

  try {
    const response = await admin.graphql(query, { variables });
    const json = (await response.json()) as {
      data?: unknown;
      errors?: Array<{ message?: string }>;
    };

    return Response.json({
      data: json.data ?? null,
      errors: json.errors ?? [],
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "There was a problem connecting to Shopify.";

    return Response.json(
      {
        data: null,
        errors: [{ message }],
      },
      { status: 500 },
    );
  }
};
