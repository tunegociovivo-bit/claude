export type DbPropertyType =
  | "TEXT"
  | "NUMBER"
  | "SELECT"
  | "MULTI_SELECT"
  | "DATE"
  | "PERSON"
  | "CHECKBOX"
  | "URL"
  | "EMAIL"
  | "PHONE";

export type DbViewType = "TABLE" | "BOARD" | "CALENDAR" | "GALLERY" | "LIST" | "TIMELINE";

export type DbProperty = {
  id: string;
  name: string;
  type: DbPropertyType;
  config: any; // { options?: {label,color}[] } para SELECT/MULTI_SELECT
  order: number;
};

export type DbView = {
  id: string;
  name: string;
  type: DbViewType;
  config: any; // { groupBy?: propertyId, dateProperty?: propertyId, ... }
  order: number;
};

export type DbRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, any>;
};

export type DbDetail = {
  id: string;
  name: string;
  icon: string | null;
  properties: DbProperty[];
  views: DbView[];
};
