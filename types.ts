export interface LinkItem {
  id: string;
  url: string;
  title: string;
  image: string;
  domain: string;
  timestamp: number;
  tags: string[];

  // Collection features
  favorite?: boolean;
  archived?: boolean;
  notes?: string;

  // Usage stats
  openCount?: number;
  lastOpenedAt?: number;

  // Rating / priority
  rating?: 0 | 1 | 2 | 3 | 4 | 5;
  priority?: "low" | "medium" | "high";

  // Health check
  checkStatus?: "unknown" | "ok" | "broken";
  lastCheckedAt?: number;
}

export interface MetadataResponse {
  title?: string;
  image?: string;
  url?: string;
  logo?: string;
}
