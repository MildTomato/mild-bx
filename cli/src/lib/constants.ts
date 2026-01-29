/**
 * Shared constants
 */

// Region type from the API
export type Region =
  | "us-east-1"
  | "us-east-2"
  | "us-west-1"
  | "us-west-2"
  | "ap-east-1"
  | "ap-southeast-1"
  | "ap-northeast-1"
  | "ap-northeast-2"
  | "ap-southeast-2"
  | "eu-west-1"
  | "eu-west-2"
  | "eu-west-3"
  | "eu-north-1"
  | "eu-central-1"
  | "eu-central-2"
  | "ca-central-1"
  | "ap-south-1"
  | "sa-east-1";

export const REGIONS: Array<{ key: string; label: string; value: Region }> = [
  { key: "us-east-1", label: "US East (N. Virginia)", value: "us-east-1" },
  { key: "us-east-2", label: "US East (Ohio)", value: "us-east-2" },
  { key: "us-west-1", label: "US West (N. California)", value: "us-west-1" },
  { key: "us-west-2", label: "US West (Oregon)", value: "us-west-2" },
  { key: "eu-central-1", label: "Europe (Frankfurt)", value: "eu-central-1" },
  { key: "eu-west-1", label: "Europe (Ireland)", value: "eu-west-1" },
  { key: "eu-west-2", label: "Europe (London)", value: "eu-west-2" },
  { key: "eu-west-3", label: "Europe (Paris)", value: "eu-west-3" },
  { key: "eu-north-1", label: "Europe (Stockholm)", value: "eu-north-1" },
  {
    key: "ap-southeast-1",
    label: "Asia Pacific (Singapore)",
    value: "ap-southeast-1",
  },
  {
    key: "ap-southeast-2",
    label: "Asia Pacific (Sydney)",
    value: "ap-southeast-2",
  },
  {
    key: "ap-northeast-1",
    label: "Asia Pacific (Tokyo)",
    value: "ap-northeast-1",
  },
  {
    key: "ap-northeast-2",
    label: "Asia Pacific (Seoul)",
    value: "ap-northeast-2",
  },
  { key: "ap-south-1", label: "Asia Pacific (Mumbai)", value: "ap-south-1" },
  { key: "ca-central-1", label: "Canada (Montreal)", value: "ca-central-1" },
  { key: "sa-east-1", label: "South America (Sao Paulo)", value: "sa-east-1" },
];

// Project status display
export function formatProjectStatus(status: string): string {
  switch (status) {
    case "ACTIVE_HEALTHY":
      return "● Healthy";
    case "ACTIVE_UNHEALTHY":
      return "● Unhealthy";
    case "COMING_UP":
      return "○ Starting";
    case "GOING_DOWN":
      return "○ Stopping";
    case "INACTIVE":
    case "PAUSED":
      return "○ Paused";
    default:
      return status;
  }
}
