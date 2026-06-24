// Loads active Blinkit Brands clients from BigQuery (accounts.id_password) —
// same source seller_v2 uses. Nothing hardcoded.
const { BigQuery } = require("@google-cloud/bigquery");
require("dotenv").config();
const log = require("../logger");

function bigqueryClient() {
  const base64 = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!base64) throw new Error("GOOGLE_CLOUD_CREDENTIALS not set");
  const credentials = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  return new BigQuery({ credentials, projectId: credentials.project_id });
}

const CLIENTS_QUERY = `
  SELECT id, client_name AS name, blinkit_brands_email AS email
  FROM \`hopeful-history-405018.accounts.id_password\`
  WHERE status = 'active'
    AND blinkit_brands_email IS NOT NULL
    AND blinkit_brands_email != ''
  ORDER BY client_name
`;

async function getClients() {
  const bq = bigqueryClient();
  const [rows] = await bq.query({ query: CLIENTS_QUERY });
  return (rows || [])
    .filter((r) => r.id != null && r.email)
    .map((r) => ({
      key: String(r.id),
      id: String(r.id),
      name: r.name || String(r.id),
      email: String(r.email).trim(),
    }));
}

module.exports = { getClients };
