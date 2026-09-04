// Generated from frozen OpenAPI and published digest evidence. DO NOT EDIT.
import type { XSchema } from 'typebox/schema';

export const contracts: readonly { readonly projectionType: string; readonly schemaVersion: string; readonly schemaDigest: string; readonly aggregateType: string; readonly envelope: XSchema; readonly payload: XSchema }[] = [
  {
    "projectionType": "hdi.charge-catalog",
    "schemaVersion": "1",
    "schemaDigest": "7cfa8efd37477a18472838a876239d97f512512076500c38f7041f31ba3ac0cf",
    "aggregateType": "CHARGE_CATALOG",
    "envelope": {
      "additionalProperties": false,
      "properties": {
        "envelopeContractVersion": {
          "enum": [
            "phase-01.v1"
          ],
          "type": "string"
        },
        "payload": {},
        "projectionContract": {
          "additionalProperties": false,
          "properties": {
            "projectionType": {
              "enum": [
                "hdi.charge-catalog"
              ],
              "type": "string"
            },
            "schemaDigest": {
              "pattern": "^[0-9a-f]{64}$",
              "type": "string"
            },
            "schemaDigestAlgorithm": {
              "enum": [
                "SHA-256"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "enum": [
                "1"
              ],
              "type": "string"
            }
          },
          "required": [
            "projectionType",
            "schemaVersion",
            "schemaDigestAlgorithm",
            "schemaDigest"
          ],
          "type": "object"
        },
        "release": {
          "additionalProperties": false,
          "properties": {
            "aggregateType": {
              "enum": [
                "CHARGE_CATALOG"
              ],
              "type": "string"
            },
            "businessValidFrom": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "businessValidTo": {
              "anyOf": [
                {
                  "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "governanceObjectId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseKind": {
              "anyOf": [
                {
                  "enum": [
                    "NORMAL"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "COMPENSATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "HISTORICAL_REPUBLICATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "CONTRACT_SCHEMA_UPGRADE"
                  ],
                  "type": "string"
                }
              ]
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "aggregateType",
            "governanceObjectId",
            "releaseId",
            "releaseNo",
            "releaseKind",
            "businessValidFrom",
            "businessValidTo"
          ],
          "type": "object"
        },
        "serializationProfileVersion": {
          "enum": [
            "canonical-json.v1"
          ],
          "type": "string"
        }
      },
      "required": [
        "envelopeContractVersion",
        "release",
        "projectionContract",
        "serializationProfileVersion",
        "payload"
      ],
      "type": "object"
    },
    "payload": {
      "additionalProperties": false,
      "properties": {
        "catalogCode": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "items": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "billingUnitCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "businessStatus": {
                "enum": [
                  "ACTIVE"
                ],
                "type": "string"
              },
              "businessValidFrom": {
                "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                "type": "string"
              },
              "businessValidTo": {
                "anyOf": [
                  {
                    "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "chargeItemId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "chargeItemVersionId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "chargingMethodCode": {
                "maxLength": 32,
                "minLength": 1,
                "type": "string"
              },
              "contentHash": {
                "pattern": "^[0-9a-f]{64}$",
                "type": "string"
              },
              "formalName": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "internalCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "recordedFrom": {
                "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                "type": "string"
              },
              "serviceDefinition": {
                "maxLength": 2000,
                "minLength": 1,
                "type": "string"
              },
              "versionNo": {
                "pattern": "^[1-9]\\d*$",
                "type": "string"
              }
            },
            "required": [
              "chargeItemId",
              "chargeItemVersionId",
              "versionNo",
              "internalCode",
              "formalName",
              "serviceDefinition",
              "billingUnitCode",
              "chargingMethodCode",
              "businessStatus",
              "businessValidFrom",
              "businessValidTo",
              "recordedFrom",
              "contentHash"
            ],
            "type": "object"
          },
          "minItems": 1,
          "type": "array"
        }
      },
      "required": [
        "catalogCode",
        "items"
      ],
      "title": "ChargeCatalogProjectionV1",
      "type": "object"
    }
  },
  {
    "projectionType": "hdi.charge-catalog",
    "schemaVersion": "2",
    "schemaDigest": "3cd3c2f8f565660420662edab1ad510b945ff070429634c7f611707f0f663521",
    "aggregateType": "CHARGE_CATALOG",
    "envelope": {
      "additionalProperties": false,
      "properties": {
        "envelopeContractVersion": {
          "enum": [
            "phase-01.v1"
          ],
          "type": "string"
        },
        "payload": {},
        "projectionContract": {
          "additionalProperties": false,
          "properties": {
            "projectionType": {
              "enum": [
                "hdi.charge-catalog"
              ],
              "type": "string"
            },
            "schemaDigest": {
              "pattern": "^[0-9a-f]{64}$",
              "type": "string"
            },
            "schemaDigestAlgorithm": {
              "enum": [
                "SHA-256"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "enum": [
                "2"
              ],
              "type": "string"
            }
          },
          "required": [
            "projectionType",
            "schemaVersion",
            "schemaDigestAlgorithm",
            "schemaDigest"
          ],
          "type": "object"
        },
        "release": {
          "additionalProperties": false,
          "properties": {
            "aggregateType": {
              "enum": [
                "CHARGE_CATALOG"
              ],
              "type": "string"
            },
            "businessValidFrom": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "businessValidTo": {
              "anyOf": [
                {
                  "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "governanceObjectId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseKind": {
              "anyOf": [
                {
                  "enum": [
                    "NORMAL"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "COMPENSATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "HISTORICAL_REPUBLICATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "CONTRACT_SCHEMA_UPGRADE"
                  ],
                  "type": "string"
                }
              ]
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "aggregateType",
            "governanceObjectId",
            "releaseId",
            "releaseNo",
            "releaseKind",
            "businessValidFrom",
            "businessValidTo"
          ],
          "type": "object"
        },
        "serializationProfileVersion": {
          "enum": [
            "canonical-json.v1"
          ],
          "type": "string"
        }
      },
      "required": [
        "envelopeContractVersion",
        "release",
        "projectionContract",
        "serializationProfileVersion",
        "payload"
      ],
      "type": "object"
    },
    "payload": {
      "additionalProperties": false,
      "properties": {
        "catalogCode": {
          "maxLength": 128,
          "minLength": 1,
          "type": "string"
        },
        "contractRevision": {
          "enum": [
            "2"
          ],
          "type": "string"
        },
        "items": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "billingUnitCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "businessStatus": {
                "enum": [
                  "ACTIVE"
                ],
                "type": "string"
              },
              "businessValidFrom": {
                "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                "type": "string"
              },
              "businessValidTo": {
                "anyOf": [
                  {
                    "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "chargeItemId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "chargeItemVersionId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "chargingMethodCode": {
                "maxLength": 32,
                "minLength": 1,
                "type": "string"
              },
              "contentHash": {
                "pattern": "^[0-9a-f]{64}$",
                "type": "string"
              },
              "formalName": {
                "maxLength": 256,
                "minLength": 1,
                "type": "string"
              },
              "internalCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "recordedFrom": {
                "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                "type": "string"
              },
              "serviceDefinition": {
                "maxLength": 2000,
                "minLength": 1,
                "type": "string"
              },
              "versionNo": {
                "pattern": "^[1-9]\\d*$",
                "type": "string"
              }
            },
            "required": [
              "chargeItemId",
              "chargeItemVersionId",
              "versionNo",
              "internalCode",
              "formalName",
              "serviceDefinition",
              "billingUnitCode",
              "chargingMethodCode",
              "businessStatus",
              "businessValidFrom",
              "businessValidTo",
              "recordedFrom",
              "contentHash"
            ],
            "type": "object"
          },
          "minItems": 1,
          "type": "array"
        }
      },
      "required": [
        "catalogCode",
        "items",
        "contractRevision"
      ],
      "title": "ChargeCatalogProjectionV2",
      "type": "object"
    }
  },
  {
    "projectionType": "hdi.price-list",
    "schemaVersion": "0",
    "schemaDigest": "c86545cd688371eca02508366fbaf7322be9b739cd09846fca634a85a157887d",
    "aggregateType": "PRICE_LIST",
    "envelope": {
      "additionalProperties": false,
      "properties": {
        "envelopeContractVersion": {
          "enum": [
            "phase-01.v1"
          ],
          "type": "string"
        },
        "payload": {},
        "projectionContract": {
          "additionalProperties": false,
          "properties": {
            "projectionType": {
              "enum": [
                "hdi.price-list"
              ],
              "type": "string"
            },
            "schemaDigest": {
              "pattern": "^[0-9a-f]{64}$",
              "type": "string"
            },
            "schemaDigestAlgorithm": {
              "enum": [
                "SHA-256"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "enum": [
                "0"
              ],
              "type": "string"
            }
          },
          "required": [
            "projectionType",
            "schemaVersion",
            "schemaDigestAlgorithm",
            "schemaDigest"
          ],
          "type": "object"
        },
        "release": {
          "additionalProperties": false,
          "properties": {
            "aggregateType": {
              "enum": [
                "PRICE_LIST"
              ],
              "type": "string"
            },
            "businessValidFrom": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "businessValidTo": {
              "anyOf": [
                {
                  "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "governanceObjectId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseKind": {
              "anyOf": [
                {
                  "enum": [
                    "NORMAL"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "COMPENSATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "HISTORICAL_REPUBLICATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "CONTRACT_SCHEMA_UPGRADE"
                  ],
                  "type": "string"
                }
              ]
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "aggregateType",
            "governanceObjectId",
            "releaseId",
            "releaseNo",
            "releaseKind",
            "businessValidFrom",
            "businessValidTo"
          ],
          "type": "object"
        },
        "serializationProfileVersion": {
          "enum": [
            "canonical-json.v1"
          ],
          "type": "string"
        }
      },
      "required": [
        "envelopeContractVersion",
        "release",
        "projectionContract",
        "serializationProfileVersion",
        "payload"
      ],
      "type": "object"
    },
    "payload": {
      "additionalProperties": false,
      "properties": {
        "legacyEntries": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "itemCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "unitPrice": {
                "pattern": "^\\d+\\.\\d{2}$",
                "type": "string"
              }
            },
            "required": [
              "itemCode",
              "unitPrice"
            ],
            "type": "object"
          },
          "minItems": 1,
          "type": "array"
        },
        "priceListCode": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "priceListId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        }
      },
      "required": [
        "priceListId",
        "priceListCode",
        "legacyEntries"
      ],
      "title": "PriceListProjectionV0",
      "type": "object"
    }
  },
  {
    "projectionType": "hdi.price-list",
    "schemaVersion": "1",
    "schemaDigest": "308b8e3b84d2ae603f1f14a901075938e26261dcd03fc3590023178309712d48",
    "aggregateType": "PRICE_LIST",
    "envelope": {
      "additionalProperties": false,
      "properties": {
        "envelopeContractVersion": {
          "enum": [
            "phase-01.v1"
          ],
          "type": "string"
        },
        "payload": {},
        "projectionContract": {
          "additionalProperties": false,
          "properties": {
            "projectionType": {
              "enum": [
                "hdi.price-list"
              ],
              "type": "string"
            },
            "schemaDigest": {
              "pattern": "^[0-9a-f]{64}$",
              "type": "string"
            },
            "schemaDigestAlgorithm": {
              "enum": [
                "SHA-256"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "enum": [
                "1"
              ],
              "type": "string"
            }
          },
          "required": [
            "projectionType",
            "schemaVersion",
            "schemaDigestAlgorithm",
            "schemaDigest"
          ],
          "type": "object"
        },
        "release": {
          "additionalProperties": false,
          "properties": {
            "aggregateType": {
              "enum": [
                "PRICE_LIST"
              ],
              "type": "string"
            },
            "businessValidFrom": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "businessValidTo": {
              "anyOf": [
                {
                  "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "governanceObjectId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseKind": {
              "anyOf": [
                {
                  "enum": [
                    "NORMAL"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "COMPENSATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "HISTORICAL_REPUBLICATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "CONTRACT_SCHEMA_UPGRADE"
                  ],
                  "type": "string"
                }
              ]
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "aggregateType",
            "governanceObjectId",
            "releaseId",
            "releaseNo",
            "releaseKind",
            "businessValidFrom",
            "businessValidTo"
          ],
          "type": "object"
        },
        "serializationProfileVersion": {
          "enum": [
            "canonical-json.v1"
          ],
          "type": "string"
        }
      },
      "required": [
        "envelopeContractVersion",
        "release",
        "projectionContract",
        "serializationProfileVersion",
        "payload"
      ],
      "type": "object"
    },
    "payload": {
      "additionalProperties": false,
      "properties": {
        "businessValidFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "businessValidTo": {
          "anyOf": [
            {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "contentHash": {
          "pattern": "^[0-9a-f]{64}$",
          "type": "string"
        },
        "currencyCode": {
          "pattern": "^[A-Z]{3}$",
          "type": "string"
        },
        "displayName": {
          "maxLength": 256,
          "minLength": 1,
          "type": "string"
        },
        "entries": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "billingUnitCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "businessValidFrom": {
                "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                "type": "string"
              },
              "businessValidTo": {
                "anyOf": [
                  {
                    "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "campusId": {
                "anyOf": [
                  {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "chargeItemId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "chargeItemInternalCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "chargeItemVersionId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "contentHash": {
                "pattern": "^[0-9a-f]{64}$",
                "type": "string"
              },
              "currencyCode": {
                "pattern": "^[A-Z]{3}$",
                "type": "string"
              },
              "encounterMode": {
                "anyOf": [
                  {
                    "enum": [
                      "GENERAL"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "SPECIFIC"
                    ],
                    "type": "string"
                  }
                ]
              },
              "encounterType": {
                "anyOf": [
                  {
                    "enum": [
                      "OUTPATIENT"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "INPATIENT"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "EMERGENCY"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "CHECKUP"
                    ],
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "entryNo": {
                "pattern": "^[1-9]\\d*$",
                "type": "string"
              },
              "fixedUnitPrice": {
                "pattern": "^\\d+\\.\\d{4}$",
                "type": "string"
              },
              "priceEntryId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "priceNature": {
                "anyOf": [
                  {
                    "enum": [
                      "HOSPITAL_DEFAULT"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "CAMPUS_DIFFERENCE"
                    ],
                    "type": "string"
                  }
                ]
              },
              "scopeLevel": {
                "anyOf": [
                  {
                    "enum": [
                      "HOSPITAL"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "CAMPUS"
                    ],
                    "type": "string"
                  }
                ]
              },
              "zeroPriceReason": {
                "anyOf": [
                  {
                    "maxLength": 500,
                    "minLength": 1,
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "required": [
              "entryNo",
              "priceEntryId",
              "chargeItemId",
              "chargeItemVersionId",
              "chargeItemInternalCode",
              "scopeLevel",
              "campusId",
              "encounterMode",
              "encounterType",
              "fixedUnitPrice",
              "currencyCode",
              "billingUnitCode",
              "businessValidFrom",
              "businessValidTo",
              "priceNature",
              "zeroPriceReason",
              "contentHash"
            ],
            "type": "object"
          },
          "minItems": 1,
          "type": "array"
        },
        "priceListCode": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "priceListId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "priceListReleaseId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "recordedFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "releaseNo": {
          "pattern": "^[1-9]\\d*$",
          "type": "string"
        }
      },
      "required": [
        "priceListId",
        "priceListReleaseId",
        "releaseNo",
        "priceListCode",
        "displayName",
        "currencyCode",
        "businessValidFrom",
        "businessValidTo",
        "recordedFrom",
        "contentHash",
        "entries"
      ],
      "title": "PriceListProjectionV1",
      "type": "object"
    }
  },
  {
    "projectionType": "hdi.price-list",
    "schemaVersion": "2",
    "schemaDigest": "7085579787d86ecb29fa08c6b669f9fc519eaec4c75f66c670bde6e3670595e7",
    "aggregateType": "PRICE_LIST",
    "envelope": {
      "additionalProperties": false,
      "properties": {
        "envelopeContractVersion": {
          "enum": [
            "phase-01.v1"
          ],
          "type": "string"
        },
        "payload": {},
        "projectionContract": {
          "additionalProperties": false,
          "properties": {
            "projectionType": {
              "enum": [
                "hdi.price-list"
              ],
              "type": "string"
            },
            "schemaDigest": {
              "pattern": "^[0-9a-f]{64}$",
              "type": "string"
            },
            "schemaDigestAlgorithm": {
              "enum": [
                "SHA-256"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "enum": [
                "2"
              ],
              "type": "string"
            }
          },
          "required": [
            "projectionType",
            "schemaVersion",
            "schemaDigestAlgorithm",
            "schemaDigest"
          ],
          "type": "object"
        },
        "release": {
          "additionalProperties": false,
          "properties": {
            "aggregateType": {
              "enum": [
                "PRICE_LIST"
              ],
              "type": "string"
            },
            "businessValidFrom": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "businessValidTo": {
              "anyOf": [
                {
                  "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "governanceObjectId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseKind": {
              "anyOf": [
                {
                  "enum": [
                    "NORMAL"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "COMPENSATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "HISTORICAL_REPUBLICATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "CONTRACT_SCHEMA_UPGRADE"
                  ],
                  "type": "string"
                }
              ]
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "aggregateType",
            "governanceObjectId",
            "releaseId",
            "releaseNo",
            "releaseKind",
            "businessValidFrom",
            "businessValidTo"
          ],
          "type": "object"
        },
        "serializationProfileVersion": {
          "enum": [
            "canonical-json.v1"
          ],
          "type": "string"
        }
      },
      "required": [
        "envelopeContractVersion",
        "release",
        "projectionContract",
        "serializationProfileVersion",
        "payload"
      ],
      "type": "object"
    },
    "payload": {
      "additionalProperties": false,
      "properties": {
        "businessValidFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "businessValidTo": {
          "anyOf": [
            {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "contentHash": {
          "pattern": "^[0-9a-f]{64}$",
          "type": "string"
        },
        "contractRevision": {
          "enum": [
            "2"
          ],
          "type": "string"
        },
        "currencyCode": {
          "pattern": "^[A-Z]{3}$",
          "type": "string"
        },
        "displayName": {
          "maxLength": 256,
          "minLength": 1,
          "type": "string"
        },
        "entries": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "billingUnitCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "businessValidFrom": {
                "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                "type": "string"
              },
              "businessValidTo": {
                "anyOf": [
                  {
                    "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "campusId": {
                "anyOf": [
                  {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "chargeItemId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "chargeItemInternalCode": {
                "maxLength": 64,
                "minLength": 1,
                "type": "string"
              },
              "chargeItemVersionId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "contentHash": {
                "pattern": "^[0-9a-f]{64}$",
                "type": "string"
              },
              "currencyCode": {
                "pattern": "^[A-Z]{3}$",
                "type": "string"
              },
              "encounterMode": {
                "anyOf": [
                  {
                    "enum": [
                      "GENERAL"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "SPECIFIC"
                    ],
                    "type": "string"
                  }
                ]
              },
              "encounterType": {
                "anyOf": [
                  {
                    "enum": [
                      "OUTPATIENT"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "INPATIENT"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "EMERGENCY"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "CHECKUP"
                    ],
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "entryNo": {
                "pattern": "^[1-9]\\d*$",
                "type": "string"
              },
              "fixedUnitPrice": {
                "pattern": "^\\d+\\.\\d{4}$",
                "type": "string"
              },
              "priceEntryId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "priceNature": {
                "anyOf": [
                  {
                    "enum": [
                      "HOSPITAL_DEFAULT"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "CAMPUS_DIFFERENCE"
                    ],
                    "type": "string"
                  }
                ]
              },
              "scopeLevel": {
                "anyOf": [
                  {
                    "enum": [
                      "HOSPITAL"
                    ],
                    "type": "string"
                  },
                  {
                    "enum": [
                      "CAMPUS"
                    ],
                    "type": "string"
                  }
                ]
              },
              "zeroPriceReason": {
                "anyOf": [
                  {
                    "maxLength": 500,
                    "minLength": 1,
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "required": [
              "entryNo",
              "priceEntryId",
              "chargeItemId",
              "chargeItemVersionId",
              "chargeItemInternalCode",
              "scopeLevel",
              "campusId",
              "encounterMode",
              "encounterType",
              "fixedUnitPrice",
              "currencyCode",
              "billingUnitCode",
              "businessValidFrom",
              "businessValidTo",
              "priceNature",
              "zeroPriceReason",
              "contentHash"
            ],
            "type": "object"
          },
          "minItems": 1,
          "type": "array"
        },
        "priceListCode": {
          "maxLength": 64,
          "minLength": 1,
          "type": "string"
        },
        "priceListId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "priceListReleaseId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "recordedFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "releaseNo": {
          "pattern": "^[1-9]\\d*$",
          "type": "string"
        }
      },
      "required": [
        "priceListId",
        "priceListReleaseId",
        "releaseNo",
        "priceListCode",
        "displayName",
        "currencyCode",
        "businessValidFrom",
        "businessValidTo",
        "recordedFrom",
        "contentHash",
        "entries",
        "contractRevision"
      ],
      "title": "PriceListProjectionV2",
      "type": "object"
    }
  },
  {
    "projectionType": "hdi.department-master",
    "schemaVersion": "1",
    "schemaDigest": "a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc",
    "aggregateType": "DEPARTMENT_MASTER",
    "envelope": {
      "additionalProperties": false,
      "properties": {
        "envelopeContractVersion": {
          "enum": [
            "phase-01.v1"
          ],
          "type": "string"
        },
        "payload": {},
        "projectionContract": {
          "additionalProperties": false,
          "properties": {
            "projectionType": {
              "enum": [
                "hdi.department-master"
              ],
              "type": "string"
            },
            "schemaDigest": {
              "pattern": "^[0-9a-f]{64}$",
              "type": "string"
            },
            "schemaDigestAlgorithm": {
              "enum": [
                "SHA-256"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "enum": [
                "1"
              ],
              "type": "string"
            }
          },
          "required": [
            "projectionType",
            "schemaVersion",
            "schemaDigestAlgorithm",
            "schemaDigest"
          ],
          "type": "object"
        },
        "release": {
          "additionalProperties": false,
          "properties": {
            "aggregateType": {
              "enum": [
                "DEPARTMENT_MASTER"
              ],
              "type": "string"
            },
            "businessValidFrom": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "businessValidTo": {
              "anyOf": [
                {
                  "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "governanceObjectId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseKind": {
              "anyOf": [
                {
                  "enum": [
                    "NORMAL"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "COMPENSATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "HISTORICAL_REPUBLICATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "CONTRACT_SCHEMA_UPGRADE"
                  ],
                  "type": "string"
                }
              ]
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "aggregateType",
            "governanceObjectId",
            "releaseId",
            "releaseNo",
            "releaseKind",
            "businessValidFrom",
            "businessValidTo"
          ],
          "type": "object"
        },
        "serializationProfileVersion": {
          "enum": [
            "canonical-json.v1"
          ],
          "type": "string"
        }
      },
      "required": [
        "envelopeContractVersion",
        "release",
        "projectionContract",
        "serializationProfileVersion",
        "payload"
      ],
      "type": "object"
    },
    "payload": {
      "additionalProperties": false,
      "properties": {
        "businessStatus": {
          "type": "string"
        },
        "businessValidFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "businessValidTo": {
          "anyOf": [
            {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "clinicalFlag": {
          "type": "boolean"
        },
        "contentHash": {
          "pattern": "^[0-9a-f]{64}$",
          "type": "string"
        },
        "departmentCode": {
          "type": "string"
        },
        "departmentId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "departmentType": {
          "type": "string"
        },
        "departmentVersionId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "managementFlag": {
          "type": "boolean"
        },
        "recordedFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "shortName": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "standardName": {
          "type": "string"
        },
        "subjectMappingApplicability": {
          "type": "string"
        },
        "versionNo": {
          "type": "string"
        }
      },
      "required": [
        "departmentCode",
        "departmentId",
        "departmentVersionId",
        "versionNo",
        "standardName",
        "shortName",
        "departmentType",
        "clinicalFlag",
        "managementFlag",
        "subjectMappingApplicability",
        "businessStatus",
        "description",
        "businessValidFrom",
        "businessValidTo",
        "recordedFrom",
        "contentHash"
      ],
      "type": "object"
    }
  },
  {
    "projectionType": "hdi.department-hierarchy",
    "schemaVersion": "1",
    "schemaDigest": "72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372",
    "aggregateType": "DEPARTMENT_HIERARCHY",
    "envelope": {
      "additionalProperties": false,
      "properties": {
        "envelopeContractVersion": {
          "enum": [
            "phase-01.v1"
          ],
          "type": "string"
        },
        "payload": {},
        "projectionContract": {
          "additionalProperties": false,
          "properties": {
            "projectionType": {
              "enum": [
                "hdi.department-hierarchy"
              ],
              "type": "string"
            },
            "schemaDigest": {
              "pattern": "^[0-9a-f]{64}$",
              "type": "string"
            },
            "schemaDigestAlgorithm": {
              "enum": [
                "SHA-256"
              ],
              "type": "string"
            },
            "schemaVersion": {
              "enum": [
                "1"
              ],
              "type": "string"
            }
          },
          "required": [
            "projectionType",
            "schemaVersion",
            "schemaDigestAlgorithm",
            "schemaDigest"
          ],
          "type": "object"
        },
        "release": {
          "additionalProperties": false,
          "properties": {
            "aggregateType": {
              "enum": [
                "DEPARTMENT_HIERARCHY"
              ],
              "type": "string"
            },
            "businessValidFrom": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "businessValidTo": {
              "anyOf": [
                {
                  "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "governanceObjectId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseKind": {
              "anyOf": [
                {
                  "enum": [
                    "NORMAL"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "COMPENSATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "HISTORICAL_REPUBLICATION"
                  ],
                  "type": "string"
                },
                {
                  "enum": [
                    "CONTRACT_SCHEMA_UPGRADE"
                  ],
                  "type": "string"
                }
              ]
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "aggregateType",
            "governanceObjectId",
            "releaseId",
            "releaseNo",
            "releaseKind",
            "businessValidFrom",
            "businessValidTo"
          ],
          "type": "object"
        },
        "serializationProfileVersion": {
          "enum": [
            "canonical-json.v1"
          ],
          "type": "string"
        }
      },
      "required": [
        "envelopeContractVersion",
        "release",
        "projectionContract",
        "serializationProfileVersion",
        "payload"
      ],
      "type": "object"
    },
    "payload": {
      "additionalProperties": false,
      "properties": {
        "businessValidFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "businessValidTo": {
          "anyOf": [
            {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "contentHash": {
          "pattern": "^[0-9a-f]{64}$",
          "type": "string"
        },
        "hierarchyViewId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "hierarchyViewVersionId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        },
        "nodes": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "departmentId": {
                "anyOf": [
                  {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "departmentVersionId": {
                "anyOf": [
                  {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "displayName": {
                "type": "string"
              },
              "groupId": {
                "anyOf": [
                  {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "groupVersionId": {
                "anyOf": [
                  {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "nodeId": {
                "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                "type": "string"
              },
              "nodeKind": {
                "type": "string"
              },
              "parentNodeId": {
                "anyOf": [
                  {
                    "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "sortOrder": {
                "type": "number"
              }
            },
            "required": [
              "nodeId",
              "parentNodeId",
              "nodeKind",
              "departmentId",
              "departmentVersionId",
              "groupId",
              "groupVersionId",
              "displayName",
              "sortOrder"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "recordedFrom": {
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
          "type": "string"
        },
        "versionNo": {
          "type": "string"
        },
        "viewCode": {
          "type": "string"
        },
        "viewType": {
          "type": "string"
        }
      },
      "required": [
        "hierarchyViewId",
        "hierarchyViewVersionId",
        "viewCode",
        "viewType",
        "versionNo",
        "businessValidFrom",
        "businessValidTo",
        "recordedFrom",
        "contentHash",
        "nodes"
      ],
      "type": "object"
    }
  }
];

export const eventsSchema: XSchema = {
  "additionalProperties": false,
  "properties": {
    "events": {
      "items": {
        "additionalProperties": false,
        "properties": {
          "aggregateVersion": {
            "pattern": "^[1-9]\\d*$",
            "type": "string"
          },
          "eventId": {
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            "type": "string"
          },
          "governanceObjectId": {
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            "type": "string"
          },
          "projectionPayloadDigest": {
            "pattern": "^[0-9a-f]{64}$",
            "type": "string"
          },
          "projectionSchemaDigest": {
            "pattern": "^[0-9a-f]{64}$",
            "type": "string"
          },
          "projectionSchemaVersion": {
            "type": "string"
          },
          "projectionType": {
            "type": "string"
          },
          "releaseId": {
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            "type": "string"
          },
          "snapshotArtifactDigest": {
            "pattern": "^[0-9a-f]{64}$",
            "type": "string"
          },
          "snapshotId": {
            "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            "type": "string"
          }
        },
        "required": [
          "eventId",
          "governanceObjectId",
          "aggregateVersion",
          "releaseId",
          "snapshotId",
          "projectionType",
          "projectionSchemaVersion",
          "projectionSchemaDigest",
          "projectionPayloadDigest",
          "snapshotArtifactDigest"
        ],
        "type": "object"
      },
      "type": "array"
    }
  },
  "required": [
    "events"
  ],
  "type": "object"
};

export const operationalSchema: XSchema = {
  "additionalProperties": false,
  "properties": {
    "applyOverdue": {
      "type": "boolean"
    },
    "evaluatedAt": {
      "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
      "type": "string"
    },
    "lastSuccessfulApply": {
      "anyOf": [
        {
          "additionalProperties": false,
          "properties": {
            "recordedAt": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "releaseId",
            "releaseNo",
            "recordedAt"
          ],
          "type": "object"
        },
        {
          "type": "null"
        }
      ]
    },
    "latestCheckpoint": {
      "anyOf": [
        {
          "additionalProperties": false,
          "properties": {
            "appliedReleaseNo": {
              "pattern": "^(?:0|[1-9]\\d*)$",
              "type": "string"
            },
            "recordedAt": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            }
          },
          "required": [
            "appliedReleaseNo",
            "recordedAt"
          ],
          "type": "object"
        },
        {
          "type": "null"
        }
      ]
    },
    "latestRelease": {
      "anyOf": [
        {
          "additionalProperties": false,
          "properties": {
            "publishedAt": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "releaseId",
            "releaseNo",
            "publishedAt"
          ],
          "type": "object"
        },
        {
          "type": "null"
        }
      ]
    },
    "lifecycleStatus": {
      "anyOf": [
        {
          "enum": [
            "ACTIVE"
          ],
          "type": "string"
        },
        {
          "enum": [
            "SUSPENDED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "REVOKED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "ARCHIVED"
          ],
          "type": "string"
        }
      ]
    },
    "oldestPendingRelease": {
      "anyOf": [
        {
          "additionalProperties": false,
          "properties": {
            "publishedAt": {
              "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
              "type": "string"
            },
            "releaseId": {
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              "type": "string"
            },
            "releaseNo": {
              "pattern": "^[1-9]\\d*$",
              "type": "string"
            }
          },
          "required": [
            "releaseId",
            "releaseNo",
            "publishedAt"
          ],
          "type": "object"
        },
        {
          "type": "null"
        }
      ]
    },
    "owner": {
      "additionalProperties": false,
      "properties": {
        "principalCode": {
          "maxLength": 128,
          "type": "string"
        },
        "servicePrincipalId": {
          "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          "type": "string"
        }
      },
      "required": [
        "servicePrincipalId",
        "principalCode"
      ],
      "type": "object"
    },
    "sla": {
      "additionalProperties": false,
      "properties": {
        "criticality": {
          "anyOf": [
            {
              "enum": [
                "LOW"
              ],
              "type": "string"
            },
            {
              "enum": [
                "NORMAL"
              ],
              "type": "string"
            },
            {
              "enum": [
                "HIGH"
              ],
              "type": "string"
            },
            {
              "enum": [
                "CRITICAL"
              ],
              "type": "string"
            }
          ]
        },
        "expectedApplyWithinSeconds": {
          "anyOf": [
            {
              "maximum": 2147483647,
              "minimum": 1,
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "retryWindowSeconds": {
          "anyOf": [
            {
              "maximum": 2147483647,
              "minimum": 1,
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "criticality",
        "expectedApplyWithinSeconds",
        "retryWindowSeconds"
      ],
      "type": "object"
    },
    "status": {
      "anyOf": [
        {
          "enum": [
            "NOT_CONFIGURED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "HEALTHY"
          ],
          "type": "string"
        },
        {
          "enum": [
            "LATE"
          ],
          "type": "string"
        },
        {
          "enum": [
            "NEVER_APPLIED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "SUSPENDED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "REVOKED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "ARCHIVED"
          ],
          "type": "string"
        }
      ]
    },
    "subscriptionId": {
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "type": "string"
    },
    "subscriptionVersionId": {
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "type": "string"
    },
    "timezone": {
      "enum": [
        "Asia/Shanghai"
      ],
      "type": "string"
    },
    "versionNo": {
      "pattern": "^[1-9]\\d*$",
      "type": "string"
    }
  },
  "required": [
    "subscriptionId",
    "subscriptionVersionId",
    "versionNo",
    "lifecycleStatus",
    "sla",
    "status",
    "applyOverdue",
    "owner",
    "evaluatedAt",
    "timezone",
    "latestRelease",
    "oldestPendingRelease",
    "lastSuccessfulApply",
    "latestCheckpoint"
  ],
  "type": "object"
};

export const receiptResponseSchema: XSchema = {
  "additionalProperties": false,
  "properties": {
    "receiptId": {
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "type": "string"
    },
    "receiptSequence": {
      "pattern": "^[1-9]\\d*$",
      "type": "string"
    }
  },
  "required": [
    "receiptId",
    "receiptSequence"
  ],
  "type": "object"
};

export const receiptBodySchema: XSchema = {
  "additionalProperties": false,
  "properties": {
    "applyResult": {
      "anyOf": [
        {
          "enum": [
            "APPLIED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "NOT_APPLIED"
          ],
          "type": "string"
        }
      ]
    },
    "eventId": {
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "type": "string"
    },
    "processedAt": {
      "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$",
      "type": "string"
    },
    "processingDigest": {
      "pattern": "^[0-9a-f]{64}$",
      "type": "string"
    },
    "receiveResult": {
      "anyOf": [
        {
          "enum": [
            "ACCEPTED"
          ],
          "type": "string"
        },
        {
          "enum": [
            "REJECTED"
          ],
          "type": "string"
        }
      ]
    },
    "validationResult": {
      "anyOf": [
        {
          "enum": [
            "VALID"
          ],
          "type": "string"
        },
        {
          "enum": [
            "INVALID"
          ],
          "type": "string"
        }
      ]
    }
  },
  "required": [
    "eventId",
    "receiveResult",
    "validationResult",
    "applyResult",
    "processingDigest",
    "processedAt"
  ],
  "type": "object"
};
