
export interface LinkItem {
  id: string;
  url: string;
  title: string;
  image: string;
  domain: string;
  timestamp: number;
  tags: string[];
}

export interface MetadataResponse {
  title?: string;
  image?: string;
  url?: string;
  logo?: string;
}
