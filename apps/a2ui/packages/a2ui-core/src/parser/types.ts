export const SERVER_TO_CLIENT_ACTIONS = [
  "beginRendering",
  "surfaceUpdate",
  "dataModelUpdate",
  "deleteSurface",
] as const;

export type ServerToClientAction = (typeof SERVER_TO_CLIENT_ACTIONS)[number];

export interface BeginRenderingMessage {
  beginRendering: {
    surfaceId: string;
    root: string;
    catalogId?: string;
    styles?: Record<string, unknown>;
  };
}

export interface SurfaceUpdateComponent {
  id: string;
  weight?: number;
  component: Record<string, unknown>;
}

export interface SurfaceUpdateMessage {
  surfaceUpdate: {
    surfaceId: string;
    components: SurfaceUpdateComponent[];
  };
}

export interface DataModelValueMapEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataModelValueMapEntry[];
}

export interface DataModelEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataModelValueMapEntry[];
}

export interface DataModelUpdateMessage {
  dataModelUpdate: {
    surfaceId: string;
    path?: string;
    contents: DataModelEntry[];
  };
}

export interface DeleteSurfaceMessage {
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIServerMessage =
  | BeginRenderingMessage
  | SurfaceUpdateMessage
  | DataModelUpdateMessage
  | DeleteSurfaceMessage;
