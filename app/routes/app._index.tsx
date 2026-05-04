import { useState } from "react";
// ─── Types ───────────────────────────────────────────────────────────────────

type ResourceType = 'product' | 'collection' | 'page' | 'article';

interface SEOFields {
  title: string | null;
  description: string | null;
}

interface Resource {
  id: string;
  title: string;
  handle: string;
  seo: SEOFields;
}

type BulkRowStatus = 'pending' | 'processing' | 'success' | 'error' | 'invalid';

interface BulkRow {
  rowNumber: number;
  rawInput: string;
  handle: string;
  metaTitle: string;
  metaDescription: string;
  validationError: string;
  status: BulkRowStatus;
  statusMessage: string;
  resourceTitle: string;
}

type AppMode = 'single' | 'bulk' | 'alttext';

type AltRowStatus = 'pending' | 'processing' | 'success' | 'error' | 'invalid';

interface AltRow {
  rowNumber: number;
  cdnUrl: string;
  altText: string;
  validationError: string;
  status: AltRowStatus;
  statusMessage: string;
  filename: string;
}

// ─── GraphQL ─────────────────────────────────────────────────────────────────

const GET_PRODUCT_BY_HANDLE = `
  query GetProductByHandle($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      title
      handle
      seo {
        title
        description
      }
    }
  }
`;

const UPDATE_PRODUCT_SEO = `
  mutation UpdateProductSEO($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_COLLECTION_BY_HANDLE = `
  query GetCollectionByHandle($query: String!) {
    collections(first: 1, query: $query) {
      edges {
        node {
          id
          title
          handle
          seo {
            title
            description
          }
        }
      }
    }
  }
`;

const UPDATE_COLLECTION_SEO = `
  mutation UpdateCollectionSEO($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_PAGE_BY_HANDLE = `
  query GetPageByHandle($query: String!) {
    pages(first: 1, query: $query) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

const GET_ARTICLE_BY_HANDLE = `
  query GetArticleByHandle($query: String!) {
    articles(first: 1, query: $query) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

const SET_SEO_METAFIELDS = `
  mutation SetSEOMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RESOURCE_LABELS: Record<ResourceType, string> = {
  product: 'Product',
  collection: 'Collection',
  page: 'Page',
  article: 'Blog Post',
};

function extractHandle(input: string): string {
  const trimmed = input.trim();
  // Strip query params and hash, then take the last path segment
  const clean = trimmed.split('?')[0].split('#')[0];
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function extractMetafieldSEO(
  metafields: Array<{ node: { key: string; value: string } }>,
): SEOFields {
  let title: string | null = null;
  let description: string | null = null;
  for (const edge of metafields) {
    // When queried with fully-qualified keys, the key field is returned as
    // "global.title_tag" / "global.description_tag"; also handle bare key names.
    const k = edge.node.key;
    if (k === 'global.title_tag' || k === 'title_tag') title = edge.node.value;
    if (k === 'global.description_tag' || k === 'description_tag') description = edge.node.value;
  }
  return { title, description };
}

async function lookupResource(
  resourceType: ResourceType,
  handle: string,
): Promise<{ resource: Resource | null; error: string }> {
  try {
    if (resourceType === 'product') {
      const { data, errors } = await runShopifyQuery(GET_PRODUCT_BY_HANDLE, {
        variables: { handle },
      });
      if (errors && errors.length > 0)
        return {
          resource: null,
          error: errors.map((e: { message: string }) => e.message).join(', '),
        };
      if (!data?.productByIdentifier)
        return {
          resource: null,
          error: 'No product found with that handle. Please check and try again.',
        };
      return { resource: data.productByIdentifier as Resource, error: '' };
    }

    if (resourceType === 'collection') {
      const { data, errors } = await runShopifyQuery(GET_COLLECTION_BY_HANDLE, {
        variables: { query: `handle:${handle}` },
      });
      if (errors && errors.length > 0)
        return {
          resource: null,
          error: errors.map((e: { message: string }) => e.message).join(', '),
        };
      const collectionNode = data?.collections?.edges?.[0]?.node;
      if (!collectionNode)
        return {
          resource: null,
          error: 'No collection found with that handle. Please check and try again.',
        };
      return { resource: collectionNode as Resource, error: '' };
    }

    if (resourceType === 'page') {
      const { data, errors } = await runShopifyQuery(GET_PAGE_BY_HANDLE, {
        variables: { query: `handle:${handle}` },
      });
      if (errors && errors.length > 0)
        return {
          resource: null,
          error: errors.map((e: { message: string }) => e.message).join(', '),
        };
      const node = data?.pages?.edges?.[0]?.node;
      if (!node)
        return {
          resource: null,
          error: 'No page found with that handle. Please check and try again.',
        };
      return {
        resource: {
          id: node.id,
          title: node.title,
          handle: node.handle,
          seo: { title: null, description: null },
        },
        error: '',
      };
    }

    if (resourceType === 'article') {
      const { data, errors } = await runShopifyQuery(GET_ARTICLE_BY_HANDLE, {
        variables: { query: `handle:${handle}` },
      });
      if (errors && errors.length > 0)
        return {
          resource: null,
          error: errors.map((e: { message: string }) => e.message).join(', '),
        };
      const node = data?.articles?.edges?.[0]?.node;
      if (!node)
        return {
          resource: null,
          error: 'No blog post found with that handle. Please check and try again.',
        };
      return {
        resource: {
          id: node.id,
          title: node.title,
          handle: node.handle,
          seo: { title: null, description: null },
        },
        error: '',
      };
    }

    return { resource: null, error: 'Unknown resource type.' };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'There was a problem connecting to Shopify. Please try again.';
    return {
      resource: null,
      error: message,
    };
  }
}

async function updateResourceSEO(
  resourceType: ResourceType,
  id: string,
  seoTitle: string,
  seoDescription: string,
): Promise<{ success: boolean; error: string }> {
  try {
    if (resourceType === 'product') {
      const seoInput: { title?: string; description?: string } = {};
      if (seoTitle.trim()) seoInput.title = seoTitle.trim();
      if (seoDescription.trim()) seoInput.description = seoDescription.trim();
      const { data, errors } = await runShopifyQuery(UPDATE_PRODUCT_SEO, {
        variables: { product: { id, seo: seoInput } },
      });
      if (errors && errors.length > 0)
        return {
          success: false,
          error: errors.map((e: { message: string }) => e.message).join(', '),
        };
      if (data?.productUpdate?.userErrors?.length > 0)
        return {
          success: false,
          error: data.productUpdate.userErrors
            .map((e: { field?: string; message: string }) =>
              e.field ? `${e.field}: ${e.message}` : e.message,
            )
            .join(', '),
        };
      return { success: true, error: '' };
    }

    if (resourceType === 'collection') {
      const seoInput: { title?: string; description?: string } = {};
      if (seoTitle.trim()) seoInput.title = seoTitle.trim();
      if (seoDescription.trim()) seoInput.description = seoDescription.trim();
      const { data, errors } = await runShopifyQuery(UPDATE_COLLECTION_SEO, {
        variables: { input: { id, seo: seoInput } },
      });
      if (errors && errors.length > 0)
        return {
          success: false,
          error: errors.map((e: { message: string }) => e.message).join(', '),
        };
      if (data?.collectionUpdate?.userErrors?.length > 0)
        return {
          success: false,
          error: data.collectionUpdate.userErrors
            .map((e: { field?: string; message: string }) =>
              e.field ? `${e.field}: ${e.message}` : e.message,
            )
            .join(', '),
        };
      return { success: true, error: '' };
    }

    // Pages and Articles use metafieldsSet
    if (resourceType === 'page' || resourceType === 'article') {
      const metafields: Array<{
        ownerId: string;
        namespace: string;
        key: string;
        value: string;
        type: string;
      }> = [];
      if (seoTitle.trim())
        metafields.push({
          ownerId: id,
          namespace: 'global',
          key: 'title_tag',
          value: seoTitle.trim(),
          type: 'single_line_text_field',
        });
      if (seoDescription.trim())
        metafields.push({
          ownerId: id,
          namespace: 'global',
          key: 'description_tag',
          value: seoDescription.trim(),
          type: 'multi_line_text_field',
        });
      if (metafields.length === 0) return { success: true, error: '' };
      const { data, errors } = await runShopifyQuery(SET_SEO_METAFIELDS, {
        variables: { metafields },
      });
      if (errors && errors.length > 0)
        return {
          success: false,
          error: errors.map((e: { message: string }) => e.message).join(', '),
        };
      if (data?.metafieldsSet?.userErrors?.length > 0)
        return {
          success: false,
          error: data.metafieldsSet.userErrors
            .map((e: { field?: string; message: string }) =>
              e.field ? `${e.field}: ${e.message}` : e.message,
            )
            .join(', '),
        };
      return { success: true, error: '' };
    }

    return { success: false, error: 'Unknown resource type.' };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'There was a problem connecting to Shopify. Please try again.';
    return {
      success: false,
      error: message,
    };
  }
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

const SAMPLE_CSV_CONTENT =
  'Product URL or Handle,Meta Title,Meta Description\n' +
  'my-product-handle,My Product Title,A great description for search engines.\n' +
  'https://yourstore.myshopify.com/products/another-product,Another Title,Another description.';

const SAMPLE_CSV_URL = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV_CONTENT)}`;

const SAMPLE_ALT_CSV_CONTENT =
  'Shopify CDN Link,Alt Text\n' +
  'https://cdn.shopify.com/s/files/1/0000/0001/files/my-image.jpg,A red coffee mug on a white background\n' +
  'https://cdn.shopify.com/s/files/1/0000/0001/files/banner.png,Summer sale banner with 20% off';

const SAMPLE_ALT_CSV_URL = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_ALT_CSV_CONTENT)}`;

const GET_FILE_BY_FILENAME = `
  query GetFileByFilename($query: String!) {
    files(first: 10, query: $query) {
      edges {
        node {
          id
          alt
          ... on MediaImage {
            image {
              url
            }
          }
          ... on GenericFile {
            url
          }
        }
      }
    }
  }
`;

const UPDATE_FILE_ALT = `
  mutation UpdateFileAltText($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        id
        alt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function runShopifyQuery(
  query: string,
  options: { variables: Record<string, unknown> },
): Promise<{ data: any; errors: Array<{ message: string }> }> {
  const formData = new FormData();
  formData.append("intent", "graphql");
  formData.append("query", query);
  formData.append("variables", JSON.stringify(options.variables ?? {}));

  try {
    const actionUrl = new URL(window.location.href);
    const response = await fetch(`/app/api${actionUrl.search}`, {
      method: "POST",
      body: formData,
      headers: {
        Accept: "application/json",
      },
    });
    const raw = await response.text();
    let payload: {
      data?: any;
      errors?: Array<{ message?: string }>;
      error?: string;
    } = {};

    try {
      payload = JSON.parse(raw) as {
        data?: any;
        errors?: Array<{ message?: string }>;
        error?: string;
      };
    } catch {
      return {
        data: null,
        errors: [
          {
            message: `Unexpected server response (${response.status}). Please refresh and try again.`,
          },
        ],
      };
    }

    if (!response.ok) {
      return {
        data: null,
        errors: [
          {
            message:
              payload.error ||
              payload.errors?.[0]?.message ||
              `Shopify request failed (${response.status}).`,
          },
        ],
      };
    }

    return {
      data: payload.data ?? null,
      errors: (payload.errors ?? []).map((e) => ({
        message: e?.message || "Unknown Shopify error",
      })),
    };
  } catch {
    return {
      data: null,
      errors: [{ message: "There was a problem connecting to Shopify. Please try again." }],
    };
  }
}

function extractFilename(url: string): string {
  try {
    const withoutQuery = url.split('?')[0];
    const parts = withoutQuery.split('/');
    return parts[parts.length - 1] ?? '';
  } catch {
    return '';
  }
}

function normalizeUrl(url: string): string {
  return url.split('?')[0].toLowerCase();
}

// ─── Single Mode ──────────────────────────────────────────────────────────────

function SingleMode(): JSX.Element {
  const [resourceType, setResourceType] = useState<ResourceType>('product');
  const [urlInput, setUrlInput] = useState<string>('');
  const [urlError, setUrlError] = useState<string>('');
  const [lookupLoading, setLookupLoading] = useState<boolean>(false);
  const [resource, setResource] = useState<Resource | null>(null);
  const [metaTitle, setMetaTitle] = useState<string>('');
  const [metaDescription, setMetaDescription] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string>('');
  const [successBanner, setSuccessBanner] = useState<string>('');

  const handleResourceTypeChange = (newType: ResourceType): void => {
    setResourceType(newType);
    setResource(null);
    setUrlInput('');
    setUrlError('');
    setMetaTitle('');
    setMetaDescription('');
    setErrorBanner('');
    setSuccessBanner('');
  };

  const handleLookup = async (): Promise<void> => {
    setUrlError('');
    setErrorBanner('');
    setSuccessBanner('');
    setResource(null);
    setMetaTitle('');
    setMetaDescription('');

    if (!urlInput.trim()) {
      setUrlError(`Please enter a ${RESOURCE_LABELS[resourceType].toLowerCase()} URL or handle.`);
      return;
    }

    const handle = extractHandle(urlInput);
    setLookupLoading(true);

    const { resource: found, error } = await lookupResource(resourceType, handle);
    setLookupLoading(false);

    if (error) {
      setErrorBanner(error);
      return;
    }
    if (found) {
      setResource(found);
      setMetaTitle(found.seo?.title ?? '');
      setMetaDescription(found.seo?.description ?? '');
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!resource) return;
    setErrorBanner('');
    setSuccessBanner('');
    setSaving(true);

    const { success, error } = await updateResourceSEO(
      resourceType,
      resource.id,
      metaTitle,
      metaDescription,
    );
    setSaving(false);

    if (!success) {
      setErrorBanner(error);
      return;
    }
    setSuccessBanner('SEO fields updated successfully.');
  };

  const descCharCount: number = metaDescription.length;
  const titleCharCount: number = metaTitle.length;
  const maxDescLength: number = 320;
  const maxTitleLength: number = 120;
  const label = RESOURCE_LABELS[resourceType];

  return (
    <>
      {errorBanner ? (
        <s-banner
          tone="critical"
          heading="An error occurred"
          dismissible
          onDismiss={() => setErrorBanner('')}
        >
          <s-text>{errorBanner}</s-text>
        </s-banner>
      ) : null}

      {successBanner ? (
        <s-banner
          tone="success"
          heading="Success"
          dismissible
          onDismiss={() => setSuccessBanner('')}
        >
          <s-text>{successBanner}</s-text>
        </s-banner>
      ) : null} 

      <s-section heading="Resource type">
        <s-stack direction="inline" gap="base">
          {(['product', 'collection', 'page', 'article'] as ResourceType[]).map((rt) => (
            <s-button
              key={rt}
              variant={resourceType === rt ? 'primary' : 'secondary'}
              onClick={() => handleResourceTypeChange(rt)}
            >
              {RESOURCE_LABELS[rt]}
            </s-button>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={`Find a ${label.toLowerCase()}`}>
        <s-text color="subdued">
          Enter a URL or handle for the {label.toLowerCase()} you want to update.
        </s-text>
        <s-text-field
          id="url-input"
          label={`${label} URL or handle`}
          placeholder={`Enter a ${label.toLowerCase()} handle...`} 
          value={urlInput}
          error={urlError}
          autocomplete="off"
          onInput={(e: Event) => {
            setUrlInput((e.currentTarget as HTMLInputElement).value);
            if (urlError) setUrlError('');
          }}
        />
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" loading={lookupLoading} onClick={handleLookup}>
            Look up {label.toLowerCase()}
          </s-button>
        </s-stack>
      </s-section>

      {lookupLoading ? (
        <s-section accessibilityLabel={`Looking up ${label.toLowerCase()}...`}>
          <s-stack direction="block" alignItems="center" gap="base">
            <s-spinner accessibilityLabel={`Looking up ${label.toLowerCase()}...`} />
            <s-text>Looking up {label.toLowerCase()}...</s-text>
          </s-stack>
        </s-section>
      ) : null}

      {resource && !lookupLoading ? (
        <s-section heading="Edit SEO fields">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text type="strong">{resource.title}</s-text>
              <s-text color="subdued">Handle: {resource.handle}</s-text>
            </s-stack>
            <s-text-field
              id="meta-title-input"
              label="Meta title"
              value={metaTitle}
              maxLength={maxTitleLength}
              autocomplete="off"
              details="Appears as the page title in search engine results. Recommended length: up to 70 characters."
              placeholder="Enter a meta title..."
              onInput={(e: Event) => {
                setMetaTitle((e.currentTarget as HTMLInputElement).value);
              }}
            />
            <s-text color="subdued">
              {titleCharCount} / {maxTitleLength} characters
            </s-text>
            <s-text-area
              id="meta-description-input"
              label="Meta description"
              value={metaDescription}
              maxLength={maxDescLength}
              rows={4}
              details="Appears in search engine results. Recommended length: up to 160 characters."
              placeholder="Write a compelling description that will appear in search engine results..."
              autocomplete="off"
              onInput={(e: Event) => {
                setMetaDescription((e.currentTarget as HTMLTextAreaElement).value);
              }}
            />
            <s-text color="subdued">
              {descCharCount} / {maxDescLength} characters
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button variant="primary" loading={saving} disabled={!resource} onClick={handleSave}>
              Save
            </s-button>
          </s-stack>
        </s-section>
      ) : null}
    </>
  );
}

// ─── Bulk Upload Mode ─────────────────────────────────────────────────────────

function BulkMode(): JSX.Element {
  const [resourceType, setResourceType] = useState<ResourceType>('product');
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [fileError, setFileError] = useState<string>('');
  const [processing, setProcessing] = useState<boolean>(false);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [done, setDone] = useState<boolean>(false);
  const [dropZoneValue, setDropZoneValue] = useState<string>('');

  const handleResourceTypeChange = (newType: ResourceType): void => {
    setResourceType(newType);
    setRows([]);
    setFileError('');
    setDone(false);
    setProcessedCount(0);
    setDropZoneValue('');
  };

  const handleFileChange = async (e: Event): Promise<void> => {
    const input = e.currentTarget as HTMLInputElement & { files?: File[] };
    const files: File[] = input.files ?? [];
    if (!files.length) return;

    setFileError('');
    setRows([]);
    setDone(false);
    setProcessedCount(0);

    const file = files[0];
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError('Could not read the file. Please try again.');
      return;
    }

    const parsed = parseCSV(text);
    if (parsed.length < 2) {
      setFileError('The file appears to be empty or has no data rows.');
      return;
    }

    // Skip header row (index 0)
    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c !== ''));
    if (!dataRows.length) {
      setFileError('No data rows found in the file.');
      return;
    }

    const built: BulkRow[] = dataRows.map((cols, idx) => {
      const rawInput = cols[0] ?? '';
      const metaTitle = cols[1] ?? '';
      const metaDescription = cols[2] ?? '';
      const handle = rawInput.trim() ? extractHandle(rawInput) : '';
      const validationError = !rawInput.trim() ? 'Missing URL or handle' : '';
      return {
        rowNumber: idx + 2,
        rawInput,
        handle,
        metaTitle,
        metaDescription,
        validationError,
        status: validationError ? 'invalid' : 'pending',
        statusMessage: validationError,
        resourceTitle: '',
      };
    });

    setRows(built);
  };

  const handleProcess = async (): Promise<void> => {
    setProcessing(true);
    setDone(false);
    setProcessedCount(0);

    const updatedRows = [...rows];
    let count = 0;

    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      if (row.status === 'invalid') continue;

      updatedRows[i] = { ...row, status: 'processing', statusMessage: 'Processing...' };
      setRows([...updatedRows]);

      // Step 1: Look up resource
      const { resource, error: lookupError } = await lookupResource(resourceType, row.handle);

      if (lookupError || !resource) {
        updatedRows[i] = {
          ...updatedRows[i],
          status: 'error',
          statusMessage: lookupError || `${RESOURCE_LABELS[resourceType]} not found`,
        };
        count++;
        setProcessedCount(count);
        setRows([...updatedRows]);
        continue;
      }

      // Step 2: Update SEO
      const { success, error: updateError } = await updateResourceSEO(
        resourceType,
        resource.id,
        row.metaTitle,
        row.metaDescription,
      );

      if (!success) {
        updatedRows[i] = {
          ...updatedRows[i],
          status: 'error',
          statusMessage: updateError,
          resourceTitle: resource.title,
        };
      } else {
        updatedRows[i] = {
          ...updatedRows[i],
          status: 'success',
          statusMessage: 'Updated successfully',
          resourceTitle: resource.title,
        };
      }

      count++;
      setProcessedCount(count);
      setRows([...updatedRows]);
    }

    setProcessing(false);
    setDone(true);
  };

  const handleReset = (): void => {
    setRows([]);
    setFileError('');
    setDone(false);
    setProcessedCount(0);
    setProcessing(false);
    setDropZoneValue('');
  };

  const validRows = rows.filter((r) => r.status !== 'invalid');
  const invalidRows = rows.filter((r) => r.status === 'invalid');
  const successCount = rows.filter((r) => r.status === 'success').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;
  const totalToProcess = validRows.length;
  const bulkLabel = RESOURCE_LABELS[resourceType];
  const bulkLabelPlural = resourceType === 'article' ? 'blog posts' : `${bulkLabel.toLowerCase()}s`;

  const statusTone = (status: BulkRowStatus): 'success' | 'critical' | 'warning' | 'neutral' => {
    if (status === 'success') return 'success';
    if (status === 'error') return 'critical';
    if (status === 'invalid') return 'warning';
    return 'neutral';
  };

  const statusLabel = (status: BulkRowStatus): string => {
    if (status === 'success') return 'Success';
    if (status === 'error') return 'Error';
    if (status === 'invalid') return 'Invalid';
    if (status === 'processing') return 'Processing';
    return 'Pending';
  };

  return (
    <>
      <s-section heading="Resource type">
        <s-text color="subdued">Select the type of resource you want to update SEO for.</s-text>
        <s-stack direction="inline" gap="base">
          {(['product', 'collection', 'page', 'article'] as ResourceType[]).map((rt) => (
            <s-button
              key={rt}
              variant={resourceType === rt ? 'primary' : 'secondary'}
              onClick={() => handleResourceTypeChange(rt)}
            >
              {RESOURCE_LABELS[rt]}
            </s-button>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Download template">
        <s-text color="subdued">
          Download the sample CSV template to see the required column format, then fill it in with
          your {bulkLabelPlural} data.
        </s-text>
        <s-stack direction="inline" gap="base">
          <s-button icon="download" href={SAMPLE_CSV_URL} download="seo-template.csv">
            Download sample CSV
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Upload CSV file">
        <s-text color="subdued">
          Upload a CSV file with columns: <s-text type="strong">URL or Handle</s-text>,{' '}
          <s-text type="strong">Meta Title</s-text>, <s-text type="strong">Meta Description</s-text>
          . The first row should be the header row.
        </s-text>
        <s-drop-zone
          label="Upload CSV file"
          accept=".csv,text/csv,text/plain"
          value={dropZoneValue}
          error={fileError}
          onChange={handleFileChange}
        />
      </s-section>

      {rows.length > 0 && !processing && !done ? (
        <>
          {invalidRows.length > 0 ? (
            <s-banner
              tone="warning"
              heading={`${invalidRows.length} row(s) have validation errors`}
            >
              <s-text>Rows with missing URL or handle will be skipped during processing.</s-text>
            </s-banner>
          ) : null}

          <s-section padding="none">
            <s-box padding="base">
              <s-heading>Preview ({rows.length} rows)</s-heading>
            </s-box>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="kicker">Row</s-table-header>
                <s-table-header listSlot="primary">URL / Handle</s-table-header>
                <s-table-header listSlot="labeled">Meta Title</s-table-header>
                <s-table-header listSlot="labeled">Meta Description</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((row) => (
                  <s-table-row key={row.rowNumber}>
                    <s-table-cell>
                      <s-text color="subdued">{row.rowNumber}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{row.rawInput || <s-text color="subdued">—</s-text>}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{row.metaTitle || <s-text color="subdued">—</s-text>}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{row.metaDescription || <s-text color="subdued">—</s-text>}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {row.status === 'invalid' ? (
                        <s-badge tone="warning">Invalid</s-badge>
                      ) : (
                        <s-badge tone="neutral">Pending</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button variant="secondary" onClick={handleReset}>
              Clear
            </s-button>
            <s-button variant="primary" disabled={totalToProcess === 0} onClick={handleProcess}>
              Process {totalToProcess}{' '}
              {totalToProcess === 1 ? bulkLabel.toLowerCase() : bulkLabelPlural}
            </s-button>
          </s-stack>
        </>
      ) : null}

      {processing ? (
        <s-section accessibilityLabel={`Processing ${bulkLabelPlural}`}>
          <s-stack direction="block" alignItems="center" gap="base">
            <s-spinner accessibilityLabel="Processing..." />
            <s-text type="strong">
              Processing {processedCount + 1} of {totalToProcess}...
            </s-text>
            <s-text color="subdued">
              Please keep this page open while {bulkLabelPlural} are being updated.
            </s-text>
          </s-stack>
        </s-section>
      ) : null}

      {done ? (
        <>
          {successCount > 0 && errorCount === 0 ? (
            <s-banner
              tone="success"
              heading={`All ${bulkLabelPlural} updated successfully`}
              dismissible
            >
              <s-text>
                {successCount} {successCount === 1 ? bulkLabel.toLowerCase() : bulkLabelPlural}{' '}
                updated.
              </s-text>
            </s-banner>
          ) : errorCount > 0 ? (
            <s-banner
              tone={successCount === 0 ? 'critical' : 'warning'}
              heading="Processing complete with errors"
            >
              <s-text>
                {successCount} succeeded, {errorCount} failed. See the results table below for
                details.
              </s-text>
            </s-banner>
          ) : null}

          <s-section padding="none">
            <s-box padding="base">
              <s-heading>Results</s-heading>
            </s-box>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="kicker">Row</s-table-header>
                <s-table-header listSlot="primary">{bulkLabel}</s-table-header>
                <s-table-header listSlot="labeled">Handle</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((row) => (
                  <s-table-row key={row.rowNumber}>
                    <s-table-cell>
                      <s-text color="subdued">{row.rowNumber}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{row.resourceTitle || row.rawInput}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{row.handle || '—'}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTone(row.status)}>{statusLabel(row.status)}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {row.status === 'error' || row.status === 'invalid' ? (
                        <s-badge tone="critical">{row.statusMessage}</s-badge>
                      ) : (
                        <s-text color="subdued">{row.statusMessage}</s-text>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button variant="secondary" onClick={handleReset}>
              Upload another file
            </s-button>
          </s-stack>
        </>
      ) : null}
    </>
  );
}

// ─── Image Alt Text Mode ──────────────────────────────────────────────────────

function AltTextMode(): JSX.Element {
  const [rows, setRows] = useState<AltRow[]>([]);
  const [fileError, setFileError] = useState<string>('');
  const [processing, setProcessing] = useState<boolean>(false);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [done, setDone] = useState<boolean>(false);
  const [dropZoneValue, setDropZoneValue] = useState<string>('');

  const handleFileChange = async (e: Event): Promise<void> => {
    const input = e.currentTarget as HTMLInputElement & { files?: File[] };
    const files: File[] = input.files ?? [];
    if (!files.length) return;

    setFileError('');
    setRows([]);
    setDone(false);
    setProcessedCount(0);

    const file = files[0];
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError('Could not read the file. Please try again.');
      return;
    }

    const parsed = parseCSV(text);
    if (parsed.length < 2) {
      setFileError('The file appears to be empty or has no data rows.');
      return;
    }

    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c !== ''));
    if (!dataRows.length) {
      setFileError('No data rows found in the file.');
      return;
    }

    const built: AltRow[] = dataRows.map((cols, idx) => {
      const cdnUrl = (cols[0] ?? '').trim();
      const altText = (cols[1] ?? '').trim();
      const filename = cdnUrl ? extractFilename(cdnUrl) : '';
      const validationError = !cdnUrl
        ? 'Missing Shopify CDN link'
        : !filename
          ? 'Could not extract filename from URL'
          : '';
      return {
        rowNumber: idx + 2,
        cdnUrl,
        altText,
        filename,
        validationError,
        status: validationError ? 'invalid' : 'pending',
        statusMessage: validationError,
      };
    });

    setRows(built);
  };

  const handleProcess = async (): Promise<void> => {
    setProcessing(true);
    setDone(false);
    setProcessedCount(0);

    const updatedRows = [...rows];
    let count = 0;
    const validTotal = updatedRows.filter((r) => r.status !== 'invalid').length;

    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      if (row.status === 'invalid') continue;

      updatedRows[i] = { ...row, status: 'processing', statusMessage: 'Processing...' };
      setRows([...updatedRows]);

      // Step 1: Find file by filename
      let fileId = '';
      try {
        const queryStr = `filename:${row.filename}`;
        const { data, errors } = await runShopifyQuery(GET_FILE_BY_FILENAME, {
          variables: { query: queryStr },
        });

        if (errors && errors.length > 0) {
          updatedRows[i] = {
            ...updatedRows[i],
            status: 'error',
            statusMessage: errors.map((e: { message: string }) => e.message).join(', '),
          };
          count++;
          setProcessedCount(count);
          setRows([...updatedRows]);
          continue;
        }

        const edges: Array<{
          node: { id: string; alt: string; image?: { url: string }; url?: string };
        }> = data?.files?.edges ?? [];

        // Match by URL (strip query params, case-insensitive)
        const targetNorm = normalizeUrl(row.cdnUrl);
        const matched = edges.find((edge) => {
          const nodeUrl: string =
            (edge.node as { image?: { url: string }; url?: string }).image?.url ??
            (edge.node as { url?: string }).url ??
            '';
          return normalizeUrl(nodeUrl) === targetNorm;
        });

        if (!matched) {
          // Fallback: if only one result and filename matches, use it
          if (edges.length === 1) {
            fileId = edges[0].node.id;
          } else {
            updatedRows[i] = {
              ...updatedRows[i],
              status: 'error',
              statusMessage: 'File not found in Shopify. Check the CDN URL and try again.',
            };
            count++;
            setProcessedCount(count);
            setRows([...updatedRows]);
            continue;
          }
        } else {
          fileId = matched.node.id;
        }
      } catch {
        updatedRows[i] = {
          ...updatedRows[i],
          status: 'error',
          statusMessage: 'There was a problem connecting to Shopify. Please try again.',
        };
        count++;
        setProcessedCount(count);
        setRows([...updatedRows]);
        continue;
      }

      // Step 2: Update alt text
      try {
        const { data, errors } = await runShopifyQuery(UPDATE_FILE_ALT, {
          variables: { files: [{ id: fileId, alt: row.altText }] },
        });

        if (errors && errors.length > 0) {
          updatedRows[i] = {
            ...updatedRows[i],
            status: 'error',
            statusMessage: errors.map((e: { message: string }) => e.message).join(', '),
          };
        } else if (data?.fileUpdate?.userErrors?.length > 0) {
          const msg = data.fileUpdate.userErrors
            .map((e: { field?: string; message: string }) =>
              e.field ? `${e.field}: ${e.message}` : e.message,
            )
            .join(', ');
          updatedRows[i] = { ...updatedRows[i], status: 'error', statusMessage: msg };
        } else {
          updatedRows[i] = {
            ...updatedRows[i],
            status: 'success',
            statusMessage: 'Alt text updated successfully',
          };
        }
      } catch {
        updatedRows[i] = {
          ...updatedRows[i],
          status: 'error',
          statusMessage: 'There was a problem connecting to Shopify. Please try again.',
        };
      }

      count++;
      setProcessedCount(count);
      setRows([...updatedRows]);
    }

    setProcessing(false);
    setDone(true);
  };

  const handleReset = (): void => {
    setRows([]);
    setFileError('');
    setDone(false);
    setProcessedCount(0);
    setProcessing(false);
    setDropZoneValue('');
  };

  const validRows = rows.filter((r) => r.status !== 'invalid');
  const invalidRows = rows.filter((r) => r.status === 'invalid');
  const successCount = rows.filter((r) => r.status === 'success').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;
  const totalToProcess = validRows.length;

  const statusTone = (status: AltRowStatus): 'success' | 'critical' | 'warning' | 'neutral' => {
    if (status === 'success') return 'success';
    if (status === 'error') return 'critical';
    if (status === 'invalid') return 'warning';
    return 'neutral';
  };

  const statusLabel = (status: AltRowStatus): string => {
    if (status === 'success') return 'Success';
    if (status === 'error') return 'Error';
    if (status === 'invalid') return 'Invalid';
    if (status === 'processing') return 'Processing';
    return 'Pending';
  };

  return (
    <>
      <s-section heading="Download template">
        <s-text color="subdued">
          Download the sample CSV template to see the required column format, then fill it in with
          your image CDN links and alt text.
        </s-text>
        <s-stack direction="inline" gap="base">
          <s-button icon="download" href={SAMPLE_ALT_CSV_URL} download="alt-text-template.csv">
            Download sample CSV
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Upload CSV file">
        <s-text color="subdued">
          Upload a CSV file with columns: <s-text type="strong">Shopify CDN Link</s-text> and{' '}
          <s-text type="strong">Alt Text</s-text>. The first row should be the header row. CDN links
          must be full Shopify CDN URLs (e.g., https://cdn.shopify.com/s/files/...).
        </s-text>
        <s-drop-zone
          label="Upload CSV file"
          accept=".csv,text/csv,text/plain"
          value={dropZoneValue}
          error={fileError}
          onChange={handleFileChange}
        />
      </s-section>

      {rows.length > 0 && !processing && !done ? (
        <>
          {invalidRows.length > 0 ? (
            <s-banner
              tone="warning"
              heading={`${invalidRows.length} row(s) have validation errors`}
            >
              <s-text>
                Rows with missing or invalid CDN links will be skipped during processing.
              </s-text>
            </s-banner>
          ) : null}

          <s-section padding="none">
            <s-box padding="base">
              <s-heading>Preview ({rows.length} rows)</s-heading>
            </s-box>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="kicker">Row</s-table-header>
                <s-table-header listSlot="primary">Shopify CDN Link</s-table-header>
                <s-table-header listSlot="labeled">Alt Text</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((row) => (
                  <s-table-row key={row.rowNumber}>
                    <s-table-cell>
                      <s-text color="subdued">{row.rowNumber}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{row.cdnUrl || <s-text color="subdued">—</s-text>}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{row.altText || <s-text color="subdued">—</s-text>}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {row.status === 'invalid' ? (
                        <s-badge tone="warning">Invalid</s-badge>
                      ) : (
                        <s-badge tone="neutral">Pending</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button variant="secondary" onClick={handleReset}>
              Clear
            </s-button>
            <s-button variant="primary" disabled={totalToProcess === 0} onClick={handleProcess}>
              Process {totalToProcess} image{totalToProcess !== 1 ? 's' : ''}
            </s-button>
          </s-stack>
        </>
      ) : null}

      {processing ? (
        <s-section accessibilityLabel="Processing images">
          <s-stack direction="block" alignItems="center" gap="base">
            <s-spinner accessibilityLabel="Processing..." />
            <s-text type="strong">
              Processing {processedCount + 1} of {totalToProcess}...
            </s-text>
            <s-text color="subdued">
              Please keep this page open while images are being updated.
            </s-text>
          </s-stack>
        </s-section>
      ) : null}

      {done ? (
        <>
          {successCount > 0 && errorCount === 0 ? (
            <s-banner tone="success" heading="All images updated successfully" dismissible>
              <s-text>
                {successCount} image{successCount !== 1 ? 's' : ''} updated.
              </s-text>
            </s-banner>
          ) : errorCount > 0 ? (
            <s-banner
              tone={successCount === 0 ? 'critical' : 'warning'}
              heading="Processing complete with errors"
            >
              <s-text>
                {successCount} succeeded, {errorCount} failed. See the results table below for
                details.
              </s-text>
            </s-banner>
          ) : null}

          <s-section padding="none">
            <s-box padding="base">
              <s-heading>Results</s-heading>
            </s-box>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="kicker">Row</s-table-header>
                <s-table-header listSlot="primary">CDN Link</s-table-header>
                <s-table-header listSlot="labeled">Alt Text</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((row) => (
                  <s-table-row key={row.rowNumber}>
                    <s-table-cell>
                      <s-text color="subdued">{row.rowNumber}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{row.filename || row.cdnUrl}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{row.altText || <s-text color="subdued">—</s-text>}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTone(row.status)}>{statusLabel(row.status)}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {row.status === 'error' || row.status === 'invalid' ? (
                        <s-badge tone="critical">{row.statusMessage}</s-badge>
                      ) : (
                        <s-text color="subdued">{row.statusMessage}</s-text>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button variant="secondary" onClick={handleReset}>
              Upload another file
            </s-button>
          </s-stack>
        </>
      ) : null}
    </>
  );
}

// ─── Root Extension ───────────────────────────────────────────────────────────

function Extension() {
  const [mode, setMode] = useState<AppMode>('single');

  return (
    <s-page heading="SEO Implementor">
      <s-section accessibilityLabel="Mode selector">
        <s-stack direction="inline" gap="base">
          <s-button
            variant={mode === 'single' ? 'primary' : 'secondary'}
            onClick={() => setMode('single')}
          >
            Single
          </s-button>
          <s-button
            variant={mode === 'bulk' ? 'primary' : 'secondary'}
            onClick={() => setMode('bulk')}
          >
            Bulk CSV
          </s-button>
          <s-button
            variant={mode === 'alttext' ? 'primary' : 'secondary'}
            onClick={() => setMode('alttext')}
          >
            Image Alt Text
          </s-button>
        </s-stack>
      </s-section>

      {mode === 'single' ? <SingleMode /> : mode === 'bulk' ? <BulkMode /> : <AltTextMode />}
    </s-page>
  );
}

export default function App() {
  return <Extension />;
}