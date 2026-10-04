// Generated from current public OpenAPI. Run vnext:contract:generate.
export const departmentForms = {
  "operations": {
    "stageDepartment": {
      "path": "/api/vnext/departments/inputs",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "jobId",
          "revisionId",
          "campus",
          "profile",
          "timePolicy",
          "entries"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "jobId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "revisionId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "timePolicy": {
            "enum": [
              "SOURCE_OFFSET_08",
              "LOCAL"
            ]
          },
          "entries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "row",
                "intent",
                "target",
                "origin",
                "evidenceId"
              ],
              "properties": {
                "row": {
                  "type": "object",
                  "required": [
                    "org_id",
                    "org_code",
                    "org_name",
                    "org_short_name",
                    "org_type",
                    "established_on",
                    "abolished_on",
                    "establishment_doc",
                    "description",
                    "is_virtual",
                    "version_no",
                    "valid_from",
                    "valid_to",
                    "record_status",
                    "source_system_id",
                    "source_record_id",
                    "approval_ref",
                    "recorded_at"
                  ],
                  "properties": {
                    "org_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "org_code": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "org_name": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 160,
                      "pattern": "\\S"
                    },
                    "org_short_name": {
                      "type": "string",
                      "maxLength": 160
                    },
                    "org_type": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "established_on": {
                      "type": "string",
                      "maxLength": 10
                    },
                    "abolished_on": {
                      "type": "string",
                      "maxLength": 10
                    },
                    "establishment_doc": {
                      "type": "string",
                      "maxLength": 256
                    },
                    "description": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "is_virtual": {
                      "enum": [
                        "Y",
                        "N"
                      ]
                    },
                    "version_no": {
                      "type": "string",
                      "pattern": "^[1-9][0-9]*$"
                    },
                    "valid_from": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 40,
                      "pattern": "\\S"
                    },
                    "valid_to": {
                      "type": "string",
                      "maxLength": 40
                    },
                    "record_status": {
                      "enum": [
                        "DRAFT",
                        "REVIEW",
                        "ACTIVE",
                        "SUSPENDED",
                        "RETIRED"
                      ]
                    },
                    "source_system_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "source_record_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "approval_ref": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "recorded_at": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 40,
                      "pattern": "\\S"
                    }
                  },
                  "additionalProperties": false
                },
                "intent": {
                  "enum": [
                    "CREATE",
                    "REVISE"
                  ]
                },
                "target": {
                  "anyOf": [
                    {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "maxLength": 19,
                          "pattern": "^[1-9][0-9]{0,18}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "origin": {
                  "enum": [
                    "NEW",
                    "HISTORICAL"
                  ]
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          },
          "sourceArtifactId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "readDepartmentInput": {
      "path": "/api/vnext/departments/inputs/read",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "previewDepartment": {
      "path": "/api/vnext/departments/preview",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "validateDepartment": {
      "path": "/api/vnext/departments/validate",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "verifyDepartmentEvidence": {
      "path": "/api/vnext/departments/verify",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "inputId",
          "inputDigest",
          "rows"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputDigest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "rows": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "row",
                "disposition",
                "historicalException",
                "reason",
                "evidenceId"
              ],
              "properties": {
                "row": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 100
                },
                "disposition": {
                  "enum": [
                    "DEPARTMENT",
                    "VIEW_GROUP",
                    "UNKNOWN"
                  ]
                },
                "historicalException": {
                  "type": "boolean"
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "additionalProperties": false
      }
    },
    "planDepartment": {
      "path": "/api/vnext/departments/plan",
      "schema": {
        "type": "object",
        "required": [
          "inputId",
          "requestId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "reviewDepartment": {
      "path": "/api/vnext/departments/review",
      "schema": {
        "type": "object",
        "required": [
          "candidateId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "approveDepartment": {
      "path": "/api/vnext/departments/approve",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "applyDepartment": {
      "path": "/api/vnext/departments/apply",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "resumeDepartment": {
      "path": "/api/vnext/departments/resume",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "listDepartments": {
      "path": "/api/vnext/departments/list",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getDepartmentAsOf": {
      "path": "/api/vnext/departments/query",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "businessAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "businessAt": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          },
          "recordAsOf": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "getDepartmentVersionHistory": {
      "path": "/api/vnext/departments/history",
      "schema": {
        "type": "object",
        "required": [
          "id"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getExactDepartmentReference": {
      "path": "/api/vnext/departments/references/exact",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "version"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "version": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getDepartmentCoverage": {
      "path": "/api/vnext/departments/references/coverage",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "validFrom",
          "validTo"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "validFrom": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          },
          "validTo": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 26,
                "pattern": "\\S"
              },
              {
                "type": "null"
              }
            ]
          },
          "recordAsOf": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          }
        },
        "additionalProperties": false
      }
    },
    "compareDepartmentVersions": {
      "path": "/api/vnext/departments/diff",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "fromVersion",
          "toVersion"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "fromVersion": {
            "type": "string"
          },
          "toVersion": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "receiveDepartmentFile": {
      "path": "/api/vnext/departments/files",
      "schema": {
        "type": "object",
        "required": [
          "metadata",
          "bytesBase64"
        ],
        "properties": {
          "metadata": {
            "type": "object",
            "required": [
              "requestId",
              "fileRequestId",
              "job",
              "campus",
              "retentionSeconds",
              "entries"
            ],
            "properties": {
              "requestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "fileRequestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "job": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "contractId",
                      "contractVersionId",
                      "profile"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "CREATE"
                        ]
                      },
                      "contractId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "contractVersionId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "profile": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "CORE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "FULL"
                            ]
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "jobId",
                      "expectedCurrentRevision"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "REVISE"
                        ]
                      },
                      "jobId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedCurrentRevision": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  }
                ]
              },
              "campus": {
                "enum": [
                  "NORTH",
                  "SOUTH"
                ]
              },
              "retentionSeconds": {
                "type": "integer",
                "minimum": 1,
                "maximum": 2592000
              },
              "entries": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "intent",
                    "target",
                    "origin",
                    "evidenceId"
                  ],
                  "properties": {
                    "intent": {
                      "enum": [
                        "CREATE",
                        "REVISE"
                      ]
                    },
                    "target": {
                      "anyOf": [
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "id",
                            "expectedVersion"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "expectedVersion": {
                              "type": "string",
                              "maxLength": 19,
                              "pattern": "^[1-9][0-9]{0,18}$"
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "origin": {
                      "enum": [
                        "NEW",
                        "HISTORICAL"
                      ]
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    }
                  }
                },
                "minItems": 1,
                "maxItems": 100
              }
            },
            "additionalProperties": false
          },
          "bytesBase64": {
            "type": "string",
            "maxLength": 1398104,
            "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getHierarchyWorkspaceTemplate": {
      "path": "/api/vnext/hierarchy/files/template",
      "schema": {
        "type": "object",
        "required": [
          "campus",
          "profile"
        ],
        "properties": {
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "receiveHierarchyWorkspaceFile": {
      "path": "/api/vnext/hierarchy/files",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "campus",
          "profile",
          "filename",
          "bytesBase64"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "filename": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "bytesBase64": {
            "type": "string",
            "maxLength": 1398104,
            "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
          }
        },
        "additionalProperties": false
      }
    },
    "createHierarchyView": {
      "path": "/api/vnext/hierarchy/views",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "sourceClientKey",
          "viewCode",
          "viewName",
          "viewType",
          "purpose",
          "aggregationRule",
          "ownerDepartmentId",
          "sourceSystemId",
          "sourceRecordId",
          "sourceVersion",
          "validFrom",
          "validTo",
          "recordedAt",
          "approvalRef"
        ],
        "properties": {
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "dependencies": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "dataset",
                "contractId",
                "contractVersionId"
              ],
              "properties": {
                "dataset": {
                  "enum": [
                    "ORG05",
                    "ORG06"
                  ]
                },
                "contractId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "contractVersionId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "maxItems": 2
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "sourceClientKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "\\S"
          },
          "viewCode": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": "\\S"
          },
          "viewName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "viewType": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "ADMINISTRATIVE"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "OPERATIONAL"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "MEDICAL_RECORD"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "FINANCE"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "STATISTICAL"
                ]
              }
            ]
          },
          "purpose": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "aggregationRule": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "ownerDepartmentId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "sourceSystemId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "sourceRecordId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "sourceVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": "\\S"
          },
          "validFrom": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          },
          "validTo": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
              },
              {
                "type": "null"
              }
            ]
          },
          "recordedAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          },
          "approvalRef": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          }
        },
        "additionalProperties": false
      }
    },
    "listHierarchyViews": {
      "path": "/api/vnext/hierarchy/views/list",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "listHierarchyCandidates": {
      "path": "/api/vnext/hierarchy/candidates/list",
      "schema": {
        "type": "object",
        "properties": {
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          },
          "viewId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "hierarchyHistory": {
      "path": "/api/vnext/hierarchy/history",
      "schema": {
        "type": "object",
        "required": [
          "viewId"
        ],
        "properties": {
          "viewId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "afterVersion": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$",
            "maxLength": 19
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "readHierarchyWindow": {
      "path": "/api/vnext/hierarchy/snapshots/window",
      "schema": {
        "type": "object",
        "required": [
          "viewId",
          "validFrom",
          "validTo"
        ],
        "properties": {
          "viewId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "validFrom": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          },
          "validTo": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
              },
              {
                "type": "null"
              }
            ]
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "importHierarchyCandidate": {
      "path": "/api/vnext/hierarchy/candidates",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "viewId",
          "sourceClientKey",
          "viewCode",
          "viewName",
          "viewType",
          "parentCardinality",
          "purpose",
          "aggregationRule",
          "ownerDepartmentId",
          "sourceSystemId",
          "sourceRecordId",
          "sourceVersion",
          "validFrom",
          "validTo",
          "recordedAt",
          "recordStatus",
          "approvalRef",
          "nodes"
        ],
        "properties": {
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "dependencies": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "dataset",
                "contractId",
                "contractVersionId"
              ],
              "properties": {
                "dataset": {
                  "enum": [
                    "ORG05",
                    "ORG06"
                  ]
                },
                "contractId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "contractVersionId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "maxItems": 2
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "viewId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "sourceClientKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "\\S"
          },
          "viewCode": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": "\\S"
          },
          "viewName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "viewType": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "ADMINISTRATIVE"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "OPERATIONAL"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "MEDICAL_RECORD"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "FINANCE"
                ]
              },
              {
                "type": "string",
                "enum": [
                  "STATISTICAL"
                ]
              }
            ]
          },
          "parentCardinality": {
            "type": "string",
            "enum": [
              "STRICT_TREE"
            ]
          },
          "purpose": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "aggregationRule": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "ownerDepartmentId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "sourceSystemId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "sourceRecordId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "sourceVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": "\\S"
          },
          "validFrom": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          },
          "validTo": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
              },
              {
                "type": "null"
              }
            ]
          },
          "recordedAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
          },
          "recordStatus": {
            "type": "string",
            "enum": [
              "ACTIVE"
            ]
          },
          "approvalRef": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "nodes": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "object",
                  "required": [
                    "sourceEvidence",
                    "nodeKey",
                    "parentNodeKey",
                    "nodeKind",
                    "departmentId",
                    "departmentVersionId",
                    "displayName",
                    "relationName",
                    "sortOrder",
                    "isPrimaryPath"
                  ],
                  "properties": {
                    "sourceEvidence": {
                      "type": "object",
                      "required": [
                        "sourceClientKey",
                        "sourceVersion",
                        "sourceSystemId",
                        "sourceRecordId",
                        "validFrom",
                        "validTo",
                        "recordedAt",
                        "recordStatus",
                        "approvalRef"
                      ],
                      "properties": {
                        "sourceClientKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 128,
                          "pattern": "\\S"
                        },
                        "sourceVersion": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 64,
                          "pattern": "\\S"
                        },
                        "sourceSystemId": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "sourceRecordId": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 256,
                          "pattern": "\\S"
                        },
                        "validFrom": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                        },
                        "validTo": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "recordedAt": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                        },
                        "recordStatus": {
                          "type": "string",
                          "enum": [
                            "ACTIVE"
                          ]
                        },
                        "approvalRef": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 256,
                          "pattern": "\\S"
                        }
                      },
                      "additionalProperties": false
                    },
                    "nodeKey": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 128,
                      "pattern": "\\S"
                    },
                    "parentNodeKey": {
                      "anyOf": [
                        {
                          "type": "string",
                          "maxLength": 128
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "nodeKind": {
                      "type": "string",
                      "enum": [
                        "DEPARTMENT"
                      ]
                    },
                    "departmentId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "departmentVersionId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "displayName": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "relationName": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 128,
                      "pattern": "\\S"
                    },
                    "sortOrder": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 2147483647
                    },
                    "isPrimaryPath": {
                      "type": "boolean"
                    }
                  },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "sourceEvidence",
                    "nodeKey",
                    "parentNodeKey",
                    "nodeKind",
                    "groupCode",
                    "groupId",
                    "groupVersionId",
                    "displayName",
                    "relationName",
                    "sortOrder",
                    "isPrimaryPath"
                  ],
                  "properties": {
                    "sourceEvidence": {
                      "type": "object",
                      "required": [
                        "sourceClientKey",
                        "sourceVersion",
                        "sourceSystemId",
                        "sourceRecordId",
                        "validFrom",
                        "validTo",
                        "recordedAt",
                        "recordStatus",
                        "approvalRef"
                      ],
                      "properties": {
                        "sourceClientKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 128,
                          "pattern": "\\S"
                        },
                        "sourceVersion": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 64,
                          "pattern": "\\S"
                        },
                        "sourceSystemId": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "sourceRecordId": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 256,
                          "pattern": "\\S"
                        },
                        "validFrom": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                        },
                        "validTo": {
                          "anyOf": [
                            {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "recordedAt": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                        },
                        "recordStatus": {
                          "type": "string",
                          "enum": [
                            "ACTIVE"
                          ]
                        },
                        "approvalRef": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 256,
                          "pattern": "\\S"
                        }
                      },
                      "additionalProperties": false
                    },
                    "nodeKey": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 128,
                      "pattern": "\\S"
                    },
                    "parentNodeKey": {
                      "anyOf": [
                        {
                          "type": "string",
                          "maxLength": 128
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "nodeKind": {
                      "type": "string",
                      "enum": [
                        "GROUP"
                      ]
                    },
                    "groupCode": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 128,
                      "pattern": "\\S"
                    },
                    "groupId": {
                      "anyOf": [
                        {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "groupVersionId": {
                      "anyOf": [
                        {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "displayName": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "relationName": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 128,
                      "pattern": "\\S"
                    },
                    "sortOrder": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 2147483647
                    },
                    "isPrimaryPath": {
                      "type": "boolean"
                    }
                  },
                  "additionalProperties": false
                }
              ]
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "additionalProperties": false
      }
    },
    "readHierarchyCandidate": {
      "path": "/api/vnext/hierarchy/candidates/read",
      "schema": {
        "type": "object",
        "required": [
          "candidateId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "approveHierarchyCandidate": {
      "path": "/api/vnext/hierarchy/candidates/approve",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "publishHierarchySnapshot": {
      "path": "/api/vnext/hierarchy/candidates/publish",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "readHierarchySnapshot": {
      "path": "/api/vnext/hierarchy/snapshots/read",
      "schema": {
        "type": "object",
        "required": [
          "viewId"
        ],
        "properties": {
          "viewId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "version": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$",
            "maxLength": 19
          }
        },
        "additionalProperties": false
      }
    },
    "diffHierarchySnapshots": {
      "path": "/api/vnext/hierarchy/snapshots/diff",
      "schema": {
        "type": "object",
        "required": [
          "viewId",
          "fromVersion",
          "toVersion"
        ],
        "properties": {
          "viewId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "fromVersion": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$",
            "maxLength": 19
          },
          "toVersion": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$",
            "maxLength": 19
          }
        },
        "additionalProperties": false
      }
    },
    "prepareHierarchyClosure": {
      "path": "/api/vnext/hierarchy/closures",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "viewId",
          "expectedVersion",
          "action",
          "reason"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "viewId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "expectedVersion": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$"
          },
          "action": {
            "enum": [
              "CLOSE",
              "REVOKE"
            ]
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          }
        },
        "additionalProperties": false
      }
    },
    "closeHierarchyView": {
      "path": "/api/vnext/hierarchy/closures/apply",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "stageOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/inputs",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "jobId",
          "revisionId",
          "campus",
          "profile",
          "entries"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "jobId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "revisionId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "entries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "action",
                "mapping",
                "reason",
                "evidenceId",
                "row"
              ],
              "properties": {
                "action": {
                  "enum": [
                    "REGISTER",
                    "CORRECT",
                    "RETRACT"
                  ]
                },
                "mapping": {
                  "anyOf": [
                    {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedHead"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master/organization-mapping"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedHead": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]{0,18}$",
                          "maxLength": 19
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "row": {
                  "type": "object",
                  "required": [
                    "org_map_id",
                    "from_system_id",
                    "source_entity_type",
                    "source_code",
                    "source_name",
                    "source_context",
                    "target_type",
                    "target_id",
                    "mapping_relation",
                    "resolution_rule",
                    "verified_by",
                    "version_no",
                    "valid_from",
                    "valid_to",
                    "record_status",
                    "source_system_id",
                    "source_record_id",
                    "approval_ref",
                    "recorded_at"
                  ],
                  "properties": {
                    "org_map_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "from_system_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "source_entity_type": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "source_code": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "source_name": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "source_context": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "target_type": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "target_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "mapping_relation": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "resolution_rule": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "verified_by": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "version_no": {
                      "type": "string",
                      "pattern": "^[1-9][0-9]{0,9}$"
                    },
                    "valid_from": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 26,
                      "pattern": "\\S"
                    },
                    "valid_to": {
                      "type": "string",
                      "maxLength": 26
                    },
                    "record_status": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "source_system_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "source_record_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "approval_ref": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "recorded_at": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 26,
                      "pattern": "\\S"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "additionalProperties": false
      }
    },
    "readOrganizationMappingInput": {
      "path": "/api/vnext/organization-mappings/inputs/read",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "previewOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/preview",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "validateOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/validate",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "verifyOrganizationMappingEvidence": {
      "path": "/api/vnext/organization-mappings/verify",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "inputId",
          "inputDigest",
          "rows"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputDigest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "rows": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "row",
                "reason",
                "evidenceId",
                "contextApproved",
                "sourceKeyReuse"
              ],
              "properties": {
                "row": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 100
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "contextApproved": {
                  "type": "boolean"
                },
                "sourceKeyReuse": {
                  "type": "boolean"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "additionalProperties": false
      }
    },
    "planOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/plan",
      "schema": {
        "type": "object",
        "required": [
          "inputId",
          "requestId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "reviewOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/review",
      "schema": {
        "type": "object",
        "required": [
          "candidateId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "approveOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/approve",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "applyOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/apply",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "resumeOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/resume",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "listOrganizationMappings": {
      "path": "/api/vnext/organization-mappings/list",
      "schema": {
        "type": "object",
        "required": [
          "campus"
        ],
        "properties": {
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationMappingHistory": {
      "path": "/api/vnext/organization-mappings/history",
      "schema": {
        "type": "object",
        "required": [
          "id"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationMappingAsOf": {
      "path": "/api/vnext/organization-mappings/query",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "businessAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "resolveOrganizationSourceMapping": {
      "path": "/api/vnext/organization-mappings/resolve",
      "schema": {
        "type": "object",
        "required": [
          "fromSystemId",
          "sourceEntityType",
          "sourceCode",
          "sourceContext",
          "campus",
          "businessAt"
        ],
        "properties": {
          "fromSystemId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "sourceEntityType": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": "\\S"
          },
          "sourceCode": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "sourceContext": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "businessAt": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          },
          "recordAsOf": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          }
        },
        "additionalProperties": false
      }
    },
    "compareOrganizationMappingVersions": {
      "path": "/api/vnext/organization-mappings/diff",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "fromVersion",
          "toVersion"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "fromVersion": {
            "type": "string"
          },
          "toVersion": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "receiveOrganizationMappingFile": {
      "path": "/api/vnext/organization-mappings/files",
      "schema": {
        "type": "object",
        "required": [
          "metadata",
          "bytesBase64"
        ],
        "properties": {
          "metadata": {
            "type": "object",
            "required": [
              "requestId",
              "fileRequestId",
              "job",
              "campus",
              "retentionSeconds",
              "entries"
            ],
            "properties": {
              "requestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "fileRequestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "job": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "contractId",
                      "contractVersionId",
                      "profile"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "CREATE"
                        ]
                      },
                      "contractId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "contractVersionId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "profile": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "CORE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "FULL"
                            ]
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "jobId",
                      "expectedCurrentRevision"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "REVISE"
                        ]
                      },
                      "jobId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedCurrentRevision": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  }
                ]
              },
              "campus": {
                "enum": [
                  "NORTH",
                  "SOUTH"
                ]
              },
              "retentionSeconds": {
                "type": "integer",
                "minimum": 1,
                "maximum": 2592000
              },
              "entries": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "action",
                    "mapping",
                    "reason",
                    "evidenceId"
                  ],
                  "properties": {
                    "action": {
                      "enum": [
                        "REGISTER",
                        "CORRECT",
                        "RETRACT"
                      ]
                    },
                    "mapping": {
                      "anyOf": [
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "id",
                            "expectedHead"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master/organization-mapping"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "expectedHead": {
                              "type": "string",
                              "pattern": "^[1-9][0-9]{0,18}$",
                              "maxLength": 19
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000,
                      "pattern": "\\S"
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    }
                  }
                },
                "minItems": 1,
                "maxItems": 100
              }
            },
            "additionalProperties": false
          },
          "bytesBase64": {
            "type": "string",
            "maxLength": 1398104,
            "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
          }
        },
        "additionalProperties": false
      }
    },
    "stageOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/inputs",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "jobId",
          "revisionId",
          "campus",
          "profile",
          "entries"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "jobId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "revisionId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "entries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "action",
                "identifier",
                "reason",
                "evidenceId",
                "row"
              ],
              "properties": {
                "action": {
                  "enum": [
                    "REGISTER",
                    "CORRECT",
                    "END",
                    "RETRACT",
                    "CHANGE"
                  ]
                },
                "identifier": {
                  "anyOf": [
                    {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedHead"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master/organization-identifier"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedHead": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]{0,18}$",
                          "maxLength": 19
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "row": {
                  "type": "object",
                  "required": [
                    "org_identifier_id",
                    "target_type",
                    "target_id",
                    "identifier_kind",
                    "identifier_system",
                    "identifier_value",
                    "language",
                    "is_preferred",
                    "version_no",
                    "valid_from",
                    "valid_to",
                    "record_status",
                    "source_system_id",
                    "source_record_id",
                    "approval_ref",
                    "recorded_at"
                  ],
                  "properties": {
                    "org_identifier_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "target_type": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "target_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "identifier_kind": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "identifier_system": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "identifier_value": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "language": {
                      "type": "string",
                      "maxLength": 64
                    },
                    "is_preferred": {
                      "enum": [
                        "Y",
                        "N"
                      ]
                    },
                    "version_no": {
                      "type": "string",
                      "pattern": "^[1-9][0-9]{0,9}$"
                    },
                    "valid_from": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 26,
                      "pattern": "\\S"
                    },
                    "valid_to": {
                      "type": "string",
                      "maxLength": 26
                    },
                    "record_status": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "source_system_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "source_record_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "approval_ref": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "recorded_at": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 26,
                      "pattern": "\\S"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "additionalProperties": false
      }
    },
    "readOrganizationIdentifierInput": {
      "path": "/api/vnext/organization-identifiers/inputs/read",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "previewOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/preview",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "validateOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/validate",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "verifyOrganizationIdentifierEvidence": {
      "path": "/api/vnext/organization-identifiers/verify",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "inputId",
          "inputDigest",
          "rows"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputDigest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "rows": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "row",
                "reason",
                "evidenceId",
                "policyApproved"
              ],
              "properties": {
                "row": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 100
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "policyApproved": {
                  "type": "boolean"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          }
        },
        "additionalProperties": false
      }
    },
    "planOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/plan",
      "schema": {
        "type": "object",
        "required": [
          "inputId",
          "requestId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "reviewOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/review",
      "schema": {
        "type": "object",
        "required": [
          "candidateId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "approveOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/approve",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "applyOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/apply",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "resumeOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/resume",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "listOrganizationIdentifiers": {
      "path": "/api/vnext/organization-identifiers/list",
      "schema": {
        "type": "object",
        "required": [
          "campus"
        ],
        "properties": {
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationIdentifierHistory": {
      "path": "/api/vnext/organization-identifiers/history",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "campus"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationIdentifierAsOf": {
      "path": "/api/vnext/organization-identifiers/query",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "campus",
          "businessAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "resolveOrganizationIdentifier": {
      "path": "/api/vnext/organization-identifiers/resolve",
      "schema": {
        "type": "object",
        "required": [
          "scheme",
          "value",
          "campus",
          "businessAt"
        ],
        "properties": {
          "scheme": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "value": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256,
            "pattern": "\\S"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "businessAt": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          },
          "recordAsOf": {
            "type": "string",
            "minLength": 1,
            "maxLength": 26,
            "pattern": "\\S"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationTargetAliases": {
      "path": "/api/vnext/organization-identifiers/targets",
      "schema": {
        "type": "object",
        "required": [
          "type",
          "id",
          "campus",
          "businessAt"
        ],
        "properties": {
          "type": {
            "enum": [
              "LEGAL",
              "CAMPUS",
              "ORG"
            ]
          },
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          }
        },
        "additionalProperties": false
      }
    },
    "getPreferredOrganizationAlias": {
      "path": "/api/vnext/organization-identifiers/preferred",
      "schema": {
        "type": "object",
        "required": [
          "type",
          "id",
          "campus",
          "scheme",
          "kind",
          "language",
          "businessAt"
        ],
        "properties": {
          "type": {
            "enum": [
              "LEGAL",
              "CAMPUS",
              "ORG"
            ]
          },
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "scheme": {
            "type": "string"
          },
          "kind": {
            "enum": [
              "ALIAS",
              "FORMER_NAME",
              "SEARCH_CODE"
            ]
          },
          "language": {
            "type": "string"
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "compareOrganizationIdentifierVersions": {
      "path": "/api/vnext/organization-identifiers/diff",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "campus",
          "fromVersion",
          "toVersion"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "fromVersion": {
            "type": "string"
          },
          "toVersion": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "receiveOrganizationIdentifierFile": {
      "path": "/api/vnext/organization-identifiers/files",
      "schema": {
        "type": "object",
        "required": [
          "metadata",
          "bytesBase64"
        ],
        "properties": {
          "metadata": {
            "type": "object",
            "required": [
              "requestId",
              "fileRequestId",
              "job",
              "campus",
              "retentionSeconds",
              "entries"
            ],
            "properties": {
              "requestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "fileRequestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "job": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "contractId",
                      "contractVersionId",
                      "profile"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "CREATE"
                        ]
                      },
                      "contractId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "contractVersionId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "profile": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "CORE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "FULL"
                            ]
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "jobId",
                      "expectedCurrentRevision"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "REVISE"
                        ]
                      },
                      "jobId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedCurrentRevision": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  }
                ]
              },
              "campus": {
                "enum": [
                  "NORTH",
                  "SOUTH"
                ]
              },
              "retentionSeconds": {
                "type": "integer",
                "minimum": 1,
                "maximum": 2592000
              },
              "entries": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "action",
                    "identifier",
                    "reason",
                    "evidenceId"
                  ],
                  "properties": {
                    "action": {
                      "enum": [
                        "REGISTER",
                        "CORRECT",
                        "END",
                        "RETRACT",
                        "CHANGE"
                      ]
                    },
                    "identifier": {
                      "anyOf": [
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "id",
                            "expectedHead"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master/organization-identifier"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "expectedHead": {
                              "type": "string",
                              "pattern": "^[1-9][0-9]{0,18}$",
                              "maxLength": 19
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000,
                      "pattern": "\\S"
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    }
                  }
                },
                "minItems": 1,
                "maxItems": 100
              }
            },
            "additionalProperties": false
          },
          "bytesBase64": {
            "type": "string",
            "maxLength": 1398104,
            "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationEvolutionTemplate": {
      "path": "/api/vnext/organization-evolutions/template",
      "schema": {
        "type": "object",
        "required": [
          "campus",
          "contractId",
          "contractVersionId",
          "contracts"
        ],
        "properties": {
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "contractId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "contractVersionId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "contracts": {
            "type": "object",
            "required": [
              "successionContractId",
              "successionContractVersionId",
              "departmentContractId",
              "departmentContractVersionId"
            ],
            "properties": {
              "successionContractId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "successionContractVersionId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "departmentContractId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "departmentContractVersionId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    },
    "receiveOrganizationEvolutionFile": {
      "path": "/api/vnext/organization-evolutions/files",
      "schema": {
        "type": "object",
        "required": [
          "metadata",
          "bytesBase64"
        ],
        "properties": {
          "metadata": {
            "type": "object",
            "required": [
              "campus",
              "predecessors",
              "rename",
              "contracts",
              "sourceSystemId",
              "decisionEvidenceId",
              "migrationEvidenceId",
              "contextEvidenceId",
              "impacts",
              "requestId",
              "fileRequestId",
              "job",
              "retentionSeconds",
              "successors"
            ],
            "properties": {
              "campusChanges": {
                "type": "array",
                "items": {
                  "anyOf": [
                    {
                      "type": "object",
                      "required": [
                        "action",
                        "departmentId",
                        "relation"
                      ],
                      "properties": {
                        "action": {
                          "type": "string",
                          "enum": [
                            "END"
                          ]
                        },
                        "departmentId": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "relation": {
                          "type": "object",
                          "required": [
                            "owner",
                            "id",
                            "expectedVersion"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master/campus-relation"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "expectedVersion": {
                              "type": "string",
                              "pattern": "^[1-9][0-9]*$"
                            }
                          },
                          "additionalProperties": false
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "required": [
                        "action",
                        "department",
                        "campus",
                        "subject",
                        "services",
                        "validTo"
                      ],
                      "properties": {
                        "action": {
                          "type": "string",
                          "enum": [
                            "ASSIGN"
                          ]
                        },
                        "department": {
                          "anyOf": [
                            {
                              "type": "object",
                              "required": [
                                "owner",
                                "id"
                              ],
                              "properties": {
                                "owner": {
                                  "type": "string",
                                  "enum": [
                                    "department-master"
                                  ]
                                },
                                "id": {
                                  "type": "string",
                                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                                }
                              },
                              "additionalProperties": false
                            },
                            {
                              "type": "object",
                              "required": [
                                "owner",
                                "alias"
                              ],
                              "properties": {
                                "owner": {
                                  "type": "string",
                                  "enum": [
                                    "department-master/evolution-successor"
                                  ]
                                },
                                "alias": {
                                  "type": "string",
                                  "minLength": 1,
                                  "maxLength": 64
                                }
                              },
                              "additionalProperties": false
                            }
                          ]
                        },
                        "campus": {
                          "type": "object",
                          "required": [
                            "owner",
                            "id"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "organization-master/campus"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            }
                          },
                          "additionalProperties": false
                        },
                        "subject": {
                          "type": "object",
                          "required": [
                            "owner",
                            "id"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "organization-master"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            }
                          },
                          "additionalProperties": false
                        },
                        "services": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 64
                          },
                          "minItems": 1,
                          "maxItems": 100,
                          "uniqueItems": true
                        },
                        "validTo": {
                          "anyOf": [
                            {
                              "type": "string"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  ]
                },
                "maxItems": 100
              },
              "compensatesEvent": {
                "type": "object",
                "required": [
                  "owner",
                  "id",
                  "version"
                ],
                "properties": {
                  "owner": {
                    "type": "string",
                    "enum": [
                      "department-master/organization-evolution"
                    ]
                  },
                  "id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "version": {
                    "type": "string",
                    "enum": [
                      "1"
                    ]
                  }
                },
                "additionalProperties": false
              },
              "campus": {
                "enum": [
                  "NORTH",
                  "SOUTH"
                ]
              },
              "predecessors": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "owner",
                    "id",
                    "expectedVersion"
                  ],
                  "properties": {
                    "owner": {
                      "type": "string",
                      "enum": [
                        "department-master"
                      ]
                    },
                    "id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "expectedVersion": {
                      "type": "string",
                      "maxLength": 19,
                      "pattern": "^[1-9][0-9]{0,18}$"
                    }
                  },
                  "additionalProperties": false
                },
                "minItems": 1,
                "maxItems": 100
              },
              "rename": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "name",
                      "shortName"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 160,
                        "pattern": "\\S"
                      },
                      "shortName": {
                        "type": "string",
                        "maxLength": 160
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "contracts": {
                "type": "object",
                "required": [
                  "successionContractId",
                  "successionContractVersionId",
                  "departmentContractId",
                  "departmentContractVersionId"
                ],
                "properties": {
                  "successionContractId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "successionContractVersionId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "departmentContractId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "departmentContractVersionId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  }
                },
                "additionalProperties": false
              },
              "sourceSystemId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "decisionEvidenceId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "migrationEvidenceId": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "contextEvidenceId": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "impacts": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "domain",
                    "determination",
                    "ownerRole",
                    "ownerSignatory",
                    "ownerDecisionRef",
                    "requiredAction",
                    "reason",
                    "evidenceId"
                  ],
                  "properties": {
                    "domain": {
                      "enum": [
                        "PERSONNEL",
                        "PATIENT",
                        "ACCOUNT",
                        "INVENTORY",
                        "FINANCE",
                        "SOURCE_MAPPING",
                        "HIERARCHY",
                        "CONSUMER",
                        "IDENTIFIER",
                        "WARD"
                      ]
                    },
                    "determination": {
                      "enum": [
                        "AFFECTED",
                        "UNAFFECTED",
                        "UNKNOWN"
                      ]
                    },
                    "ownerRole": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 160,
                      "pattern": "\\S"
                    },
                    "ownerSignatory": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 160,
                      "pattern": "\\S"
                    },
                    "ownerDecisionRef": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "requiredAction": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000,
                      "pattern": "\\S"
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    }
                  },
                  "additionalProperties": false
                },
                "minItems": 10,
                "maxItems": 10
              },
              "requestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "fileRequestId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "job": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "contractId",
                      "contractVersionId",
                      "profile"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "CREATE"
                        ]
                      },
                      "contractId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "contractVersionId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "profile": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "CORE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "FULL"
                            ]
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "required": [
                      "scope",
                      "requestId",
                      "reason",
                      "input",
                      "action",
                      "jobId",
                      "expectedCurrentRevision"
                    ],
                    "properties": {
                      "scope": {
                        "anyOf": [
                          {
                            "type": "string",
                            "enum": [
                              "BASELINE"
                            ]
                          },
                          {
                            "type": "string",
                            "enum": [
                              "SYNTHETIC"
                            ]
                          }
                        ]
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "reason": {
                        "type": "string",
                        "pattern": "^[A-Z_]{1,64}$"
                      },
                      "input": {
                        "anyOf": [
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORGANIZATION_EVOLUTION_V1"
                                ]
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy",
                              "manifestDigest",
                              "contractsDigest"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "type": "string",
                                "enum": [
                                  "XLSX"
                                ]
                              },
                              "parserPolicy": {
                                "type": "string",
                                "enum": [
                                  "STRICT_ORG_BUNDLE_V1"
                                ]
                              },
                              "manifestDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              },
                              "contractsDigest": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "declaredSha256"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "METADATA_ONLY"
                                ]
                              },
                              "declaredSha256": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{64}$"
                              }
                            },
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "required": [
                              "kind",
                              "format",
                              "parserPolicy"
                            ],
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "FILE"
                                ]
                              },
                              "format": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "CSV"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "JSON"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "XLSX"
                                    ]
                                  }
                                ]
                              },
                              "parserPolicy": {
                                "anyOf": [
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_V2"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_DEPARTMENT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_MAPPING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_ORGANIZATION_IDENTIFIER_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_LOCATION_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_UNIT_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_NURSING_V1"
                                    ]
                                  },
                                  {
                                    "type": "string",
                                    "enum": [
                                      "STRICT_WARD_V1"
                                    ]
                                  }
                                ]
                              }
                            },
                            "additionalProperties": false
                          }
                        ]
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "REVISE"
                        ]
                      },
                      "jobId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedCurrentRevision": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  }
                ]
              },
              "retentionSeconds": {
                "type": "integer",
                "minimum": 1,
                "maximum": 2592000
              },
              "successors": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "intent",
                    "target",
                    "origin",
                    "evidenceId"
                  ],
                  "properties": {
                    "intent": {
                      "enum": [
                        "CREATE",
                        "REVISE"
                      ]
                    },
                    "target": {
                      "anyOf": [
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "id",
                            "expectedVersion"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "expectedVersion": {
                              "type": "string",
                              "maxLength": 19,
                              "pattern": "^[1-9][0-9]{0,18}$"
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "origin": {
                      "enum": [
                        "NEW",
                        "HISTORICAL"
                      ]
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    }
                  }
                },
                "maxItems": 100
              }
            },
            "additionalProperties": false
          },
          "bytesBase64": {
            "type": "string",
            "maxLength": 1398104,
            "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
          }
        },
        "additionalProperties": false
      }
    },
    "stageOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/inputs",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "jobId",
          "revisionId",
          "campus",
          "profile",
          "event",
          "relations",
          "predecessors",
          "successors",
          "rename",
          "contracts",
          "sourceSystemId",
          "decisionEvidenceId",
          "migrationEvidenceId",
          "contextEvidenceId",
          "impacts"
        ],
        "properties": {
          "campusChanges": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "object",
                  "required": [
                    "action",
                    "departmentId",
                    "relation"
                  ],
                  "properties": {
                    "action": {
                      "type": "string",
                      "enum": [
                        "END"
                      ]
                    },
                    "departmentId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "relation": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master/campus-relation"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "action",
                    "department",
                    "campus",
                    "subject",
                    "services",
                    "validTo"
                  ],
                  "properties": {
                    "action": {
                      "type": "string",
                      "enum": [
                        "ASSIGN"
                      ]
                    },
                    "department": {
                      "anyOf": [
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "id"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "alias"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master/evolution-successor"
                              ]
                            },
                            "alias": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 64
                            }
                          },
                          "additionalProperties": false
                        }
                      ]
                    },
                    "campus": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "organization-master/campus"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "subject": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "organization-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "services": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64
                      },
                      "minItems": 1,
                      "maxItems": 100,
                      "uniqueItems": true
                    },
                    "validTo": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                }
              ]
            },
            "maxItems": 100
          },
          "compensatesEvent": {
            "type": "object",
            "required": [
              "owner",
              "id",
              "version"
            ],
            "properties": {
              "owner": {
                "type": "string",
                "enum": [
                  "department-master/organization-evolution"
                ]
              },
              "id": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "version": {
                "type": "string",
                "enum": [
                  "1"
                ]
              }
            },
            "additionalProperties": false
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "jobId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "revisionId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "event": {
            "type": "object",
            "required": [
              "org_event_id",
              "change_type",
              "effective_at",
              "decision_ref",
              "reason",
              "historical_reporting_rule",
              "migration_plan_ref",
              "recorded_at"
            ],
            "properties": {
              "org_event_id": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "\\S"
              },
              "change_type": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "\\S"
              },
              "effective_at": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40,
                "pattern": "\\S"
              },
              "decision_ref": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "\\S"
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "historical_reporting_rule": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "migration_plan_ref": {
                "type": "string",
                "maxLength": 256
              },
              "recorded_at": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40,
                "pattern": "\\S"
              }
            },
            "additionalProperties": false
          },
          "relations": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "succession_id",
                "org_event_id",
                "from_target_type",
                "from_target_id",
                "to_target_type",
                "to_target_id",
                "transfer_scope",
                "context_rule",
                "recorded_at"
              ],
              "properties": {
                "succession_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 64,
                  "pattern": "\\S"
                },
                "org_event_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 64,
                  "pattern": "\\S"
                },
                "from_target_type": {
                  "type": "string",
                  "maxLength": 64
                },
                "from_target_id": {
                  "type": "string",
                  "maxLength": 64
                },
                "to_target_type": {
                  "type": "string",
                  "maxLength": 64
                },
                "to_target_id": {
                  "type": "string",
                  "maxLength": 64
                },
                "transfer_scope": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "context_rule": {
                  "type": "string",
                  "maxLength": 2000
                },
                "recorded_at": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 40,
                  "pattern": "\\S"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          },
          "predecessors": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "owner",
                "id",
                "expectedVersion"
              ],
              "properties": {
                "owner": {
                  "type": "string",
                  "enum": [
                    "department-master"
                  ]
                },
                "id": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "expectedVersion": {
                  "type": "string",
                  "maxLength": 19,
                  "pattern": "^[1-9][0-9]{0,18}$"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          },
          "successors": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "row",
                "intent",
                "target",
                "origin",
                "evidenceId"
              ],
              "properties": {
                "row": {
                  "type": "object",
                  "required": [
                    "org_id",
                    "org_code",
                    "org_name",
                    "org_short_name",
                    "org_type",
                    "established_on",
                    "abolished_on",
                    "establishment_doc",
                    "description",
                    "is_virtual",
                    "version_no",
                    "valid_from",
                    "valid_to",
                    "record_status",
                    "source_system_id",
                    "source_record_id",
                    "approval_ref",
                    "recorded_at"
                  ],
                  "properties": {
                    "org_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "org_code": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "org_name": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 160,
                      "pattern": "\\S"
                    },
                    "org_short_name": {
                      "type": "string",
                      "maxLength": 160
                    },
                    "org_type": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "established_on": {
                      "type": "string",
                      "maxLength": 10
                    },
                    "abolished_on": {
                      "type": "string",
                      "maxLength": 10
                    },
                    "establishment_doc": {
                      "type": "string",
                      "maxLength": 256
                    },
                    "description": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "is_virtual": {
                      "enum": [
                        "Y",
                        "N"
                      ]
                    },
                    "version_no": {
                      "type": "string",
                      "pattern": "^[1-9][0-9]*$"
                    },
                    "valid_from": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 40,
                      "pattern": "\\S"
                    },
                    "valid_to": {
                      "type": "string",
                      "maxLength": 40
                    },
                    "record_status": {
                      "enum": [
                        "DRAFT",
                        "REVIEW",
                        "ACTIVE",
                        "SUSPENDED",
                        "RETIRED"
                      ]
                    },
                    "source_system_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "source_record_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "approval_ref": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "recorded_at": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 40,
                      "pattern": "\\S"
                    }
                  },
                  "additionalProperties": false
                },
                "intent": {
                  "enum": [
                    "CREATE",
                    "REVISE"
                  ]
                },
                "target": {
                  "anyOf": [
                    {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "maxLength": 19,
                          "pattern": "^[1-9][0-9]{0,18}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "origin": {
                  "enum": [
                    "NEW",
                    "HISTORICAL"
                  ]
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "maxItems": 100
          },
          "rename": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "name",
                  "shortName"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "pattern": "\\S"
                  },
                  "shortName": {
                    "type": "string",
                    "maxLength": 160
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          },
          "contracts": {
            "type": "object",
            "required": [
              "successionContractId",
              "successionContractVersionId",
              "departmentContractId",
              "departmentContractVersionId"
            ],
            "properties": {
              "successionContractId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "successionContractVersionId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "departmentContractId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "departmentContractVersionId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          },
          "sourceSystemId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "decisionEvidenceId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "migrationEvidenceId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "contextEvidenceId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "impacts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "domain",
                "determination",
                "ownerRole",
                "ownerSignatory",
                "ownerDecisionRef",
                "requiredAction",
                "reason",
                "evidenceId"
              ],
              "properties": {
                "domain": {
                  "enum": [
                    "PERSONNEL",
                    "PATIENT",
                    "ACCOUNT",
                    "INVENTORY",
                    "FINANCE",
                    "SOURCE_MAPPING",
                    "HIERARCHY",
                    "CONSUMER",
                    "IDENTIFIER",
                    "WARD"
                  ]
                },
                "determination": {
                  "enum": [
                    "AFFECTED",
                    "UNAFFECTED",
                    "UNKNOWN"
                  ]
                },
                "ownerRole": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "\\S"
                },
                "ownerSignatory": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "\\S"
                },
                "ownerDecisionRef": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256,
                  "pattern": "\\S"
                },
                "requiredAction": {
                  "type": "string",
                  "maxLength": 2000
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "minItems": 10,
            "maxItems": 10
          }
        },
        "additionalProperties": false
      }
    },
    "compensateDepartmentEvolution": {
      "path": "/api/vnext/organization-evolutions/compensate",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "jobId",
          "revisionId",
          "campus",
          "profile",
          "event",
          "relations",
          "predecessors",
          "successors",
          "rename",
          "contracts",
          "sourceSystemId",
          "decisionEvidenceId",
          "migrationEvidenceId",
          "contextEvidenceId",
          "impacts"
        ],
        "properties": {
          "campusChanges": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "object",
                  "required": [
                    "action",
                    "departmentId",
                    "relation"
                  ],
                  "properties": {
                    "action": {
                      "type": "string",
                      "enum": [
                        "END"
                      ]
                    },
                    "departmentId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "relation": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master/campus-relation"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "action",
                    "department",
                    "campus",
                    "subject",
                    "services",
                    "validTo"
                  ],
                  "properties": {
                    "action": {
                      "type": "string",
                      "enum": [
                        "ASSIGN"
                      ]
                    },
                    "department": {
                      "anyOf": [
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "id"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "required": [
                            "owner",
                            "alias"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "department-master/evolution-successor"
                              ]
                            },
                            "alias": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 64
                            }
                          },
                          "additionalProperties": false
                        }
                      ]
                    },
                    "campus": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "organization-master/campus"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "subject": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "organization-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "services": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64
                      },
                      "minItems": 1,
                      "maxItems": 100,
                      "uniqueItems": true
                    },
                    "validTo": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                }
              ]
            },
            "maxItems": 100
          },
          "compensatesEvent": {
            "type": "object",
            "required": [
              "owner",
              "id",
              "version"
            ],
            "properties": {
              "owner": {
                "type": "string",
                "enum": [
                  "department-master/organization-evolution"
                ]
              },
              "id": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "version": {
                "type": "string",
                "enum": [
                  "1"
                ]
              }
            },
            "additionalProperties": false
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "jobId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "revisionId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "event": {
            "type": "object",
            "required": [
              "org_event_id",
              "change_type",
              "effective_at",
              "decision_ref",
              "reason",
              "historical_reporting_rule",
              "migration_plan_ref",
              "recorded_at"
            ],
            "properties": {
              "org_event_id": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "\\S"
              },
              "change_type": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "\\S"
              },
              "effective_at": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40,
                "pattern": "\\S"
              },
              "decision_ref": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "\\S"
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "historical_reporting_rule": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "migration_plan_ref": {
                "type": "string",
                "maxLength": 256
              },
              "recorded_at": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40,
                "pattern": "\\S"
              }
            },
            "additionalProperties": false
          },
          "relations": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "succession_id",
                "org_event_id",
                "from_target_type",
                "from_target_id",
                "to_target_type",
                "to_target_id",
                "transfer_scope",
                "context_rule",
                "recorded_at"
              ],
              "properties": {
                "succession_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 64,
                  "pattern": "\\S"
                },
                "org_event_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 64,
                  "pattern": "\\S"
                },
                "from_target_type": {
                  "type": "string",
                  "maxLength": 64
                },
                "from_target_id": {
                  "type": "string",
                  "maxLength": 64
                },
                "to_target_type": {
                  "type": "string",
                  "maxLength": 64
                },
                "to_target_id": {
                  "type": "string",
                  "maxLength": 64
                },
                "transfer_scope": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "context_rule": {
                  "type": "string",
                  "maxLength": 2000
                },
                "recorded_at": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 40,
                  "pattern": "\\S"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          },
          "predecessors": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "owner",
                "id",
                "expectedVersion"
              ],
              "properties": {
                "owner": {
                  "type": "string",
                  "enum": [
                    "department-master"
                  ]
                },
                "id": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "expectedVersion": {
                  "type": "string",
                  "maxLength": 19,
                  "pattern": "^[1-9][0-9]{0,18}$"
                }
              },
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 100
          },
          "successors": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "row",
                "intent",
                "target",
                "origin",
                "evidenceId"
              ],
              "properties": {
                "row": {
                  "type": "object",
                  "required": [
                    "org_id",
                    "org_code",
                    "org_name",
                    "org_short_name",
                    "org_type",
                    "established_on",
                    "abolished_on",
                    "establishment_doc",
                    "description",
                    "is_virtual",
                    "version_no",
                    "valid_from",
                    "valid_to",
                    "record_status",
                    "source_system_id",
                    "source_record_id",
                    "approval_ref",
                    "recorded_at"
                  ],
                  "properties": {
                    "org_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "org_code": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "org_name": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 160,
                      "pattern": "\\S"
                    },
                    "org_short_name": {
                      "type": "string",
                      "maxLength": 160
                    },
                    "org_type": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64,
                      "pattern": "\\S"
                    },
                    "established_on": {
                      "type": "string",
                      "maxLength": 10
                    },
                    "abolished_on": {
                      "type": "string",
                      "maxLength": 10
                    },
                    "establishment_doc": {
                      "type": "string",
                      "maxLength": 256
                    },
                    "description": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "is_virtual": {
                      "enum": [
                        "Y",
                        "N"
                      ]
                    },
                    "version_no": {
                      "type": "string",
                      "pattern": "^[1-9][0-9]*$"
                    },
                    "valid_from": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 40,
                      "pattern": "\\S"
                    },
                    "valid_to": {
                      "type": "string",
                      "maxLength": 40
                    },
                    "record_status": {
                      "enum": [
                        "DRAFT",
                        "REVIEW",
                        "ACTIVE",
                        "SUSPENDED",
                        "RETIRED"
                      ]
                    },
                    "source_system_id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "source_record_id": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 256,
                      "pattern": "\\S"
                    },
                    "approval_ref": {
                      "type": "string",
                      "maxLength": 2000
                    },
                    "recorded_at": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 40,
                      "pattern": "\\S"
                    }
                  },
                  "additionalProperties": false
                },
                "intent": {
                  "enum": [
                    "CREATE",
                    "REVISE"
                  ]
                },
                "target": {
                  "anyOf": [
                    {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "maxLength": 19,
                          "pattern": "^[1-9][0-9]{0,18}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "origin": {
                  "enum": [
                    "NEW",
                    "HISTORICAL"
                  ]
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "maxItems": 100
          },
          "rename": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "name",
                  "shortName"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "pattern": "\\S"
                  },
                  "shortName": {
                    "type": "string",
                    "maxLength": 160
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          },
          "contracts": {
            "type": "object",
            "required": [
              "successionContractId",
              "successionContractVersionId",
              "departmentContractId",
              "departmentContractVersionId"
            ],
            "properties": {
              "successionContractId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "successionContractVersionId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "departmentContractId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "departmentContractVersionId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          },
          "sourceSystemId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "decisionEvidenceId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "migrationEvidenceId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "contextEvidenceId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "impacts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "domain",
                "determination",
                "ownerRole",
                "ownerSignatory",
                "ownerDecisionRef",
                "requiredAction",
                "reason",
                "evidenceId"
              ],
              "properties": {
                "domain": {
                  "enum": [
                    "PERSONNEL",
                    "PATIENT",
                    "ACCOUNT",
                    "INVENTORY",
                    "FINANCE",
                    "SOURCE_MAPPING",
                    "HIERARCHY",
                    "CONSUMER",
                    "IDENTIFIER",
                    "WARD"
                  ]
                },
                "determination": {
                  "enum": [
                    "AFFECTED",
                    "UNAFFECTED",
                    "UNKNOWN"
                  ]
                },
                "ownerRole": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "\\S"
                },
                "ownerSignatory": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "\\S"
                },
                "ownerDecisionRef": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256,
                  "pattern": "\\S"
                },
                "requiredAction": {
                  "type": "string",
                  "maxLength": 2000
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "minItems": 10,
            "maxItems": 10
          }
        },
        "additionalProperties": false
      }
    },
    "readOrganizationEvolutionInput": {
      "path": "/api/vnext/organization-evolutions/inputs/read",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "previewOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/preview",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "validateOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/validate",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "verifyOrganizationEvolutionEvidence": {
      "path": "/api/vnext/organization-evolutions/verify",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "inputId",
          "inputDigest",
          "reason",
          "policyApproved",
          "materialsAccepted",
          "impactReviews"
        ],
        "properties": {
          "impactAssessment": {
            "type": "object",
            "required": [
              "id",
              "digest"
            ],
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "digest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "additionalProperties": false
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputDigest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "policyApproved": {
            "type": "boolean"
          },
          "materialsAccepted": {
            "type": "boolean"
          },
          "impactReviews": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "domain",
                "ownerAttestationAccepted",
                "dispositionAccepted",
                "reason"
              ],
              "properties": {
                "domain": {
                  "enum": [
                    "PERSONNEL",
                    "PATIENT",
                    "ACCOUNT",
                    "INVENTORY",
                    "FINANCE",
                    "SOURCE_MAPPING",
                    "HIERARCHY",
                    "CONSUMER",
                    "IDENTIFIER",
                    "WARD"
                  ]
                },
                "ownerAttestationAccepted": {
                  "type": "boolean"
                },
                "dispositionAccepted": {
                  "type": "boolean"
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                }
              },
              "additionalProperties": false
            },
            "minItems": 10,
            "maxItems": 10
          }
        },
        "additionalProperties": false
      }
    },
    "planOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/plan",
      "schema": {
        "type": "object",
        "required": [
          "inputId",
          "requestId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "reviewOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/review",
      "schema": {
        "type": "object",
        "required": [
          "candidateId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "approveOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/approve",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "applyOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/apply",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "resumeOrganizationEvolution": {
      "path": "/api/vnext/organization-evolutions/resume",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationEvolutionAsOf": {
      "path": "/api/vnext/organization-evolutions/query",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "campus",
          "businessAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getOrganizationEvolutionGraph": {
      "path": "/api/vnext/organization-evolutions/graph",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "campus",
          "businessAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getDepartmentEvolutionHistory": {
      "path": "/api/vnext/organization-evolutions/history",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "campus",
          "businessAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          }
        },
        "additionalProperties": false
      }
    },
    "listOrganizationEvolutions": {
      "path": "/api/vnext/organization-evolutions/list",
      "schema": {
        "type": "object",
        "required": [
          "campus"
        ],
        "properties": {
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "assessDepartmentChange": {
      "path": "/api/vnext/department-impacts/assess",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "reason",
          "target"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "target": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "kind",
                  "id"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "INPUT"
                    ]
                  },
                  "id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "kind",
                  "id",
                  "campus"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "EVENT"
                    ]
                  },
                  "id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "campus": {
                    "enum": [
                      "NORTH",
                      "SOUTH"
                    ]
                  }
                },
                "additionalProperties": false
              }
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "readDepartmentAssessment": {
      "path": "/api/vnext/department-impacts/assessments/read",
      "schema": {
        "type": "object",
        "required": [
          "assessmentId",
          "campus"
        ],
        "properties": {
          "assessmentId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "listDepartmentAssessments": {
      "path": "/api/vnext/department-impacts/assessments",
      "schema": {
        "type": "object",
        "required": [
          "target"
        ],
        "properties": {
          "target": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "kind",
                  "id"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "INPUT"
                    ]
                  },
                  "id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "kind",
                  "id",
                  "campus"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "EVENT"
                    ]
                  },
                  "id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "campus": {
                    "enum": [
                      "NORTH",
                      "SOUTH"
                    ]
                  }
                },
                "additionalProperties": false
              }
            ]
          },
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          }
        },
        "additionalProperties": false
      }
    },
    "listDepartmentImpactCases": {
      "path": "/api/vnext/department-impacts/cases",
      "schema": {
        "type": "object",
        "required": [
          "eventId",
          "campus"
        ],
        "properties": {
          "eventId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "after": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          }
        },
        "additionalProperties": false
      }
    },
    "readDepartmentImpactCase": {
      "path": "/api/vnext/department-impacts/cases/read",
      "schema": {
        "type": "object",
        "required": [
          "caseId",
          "campus"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "assignDepartmentImpactCase": {
      "path": "/api/vnext/department-impacts/assign",
      "schema": {
        "type": "object",
        "required": [
          "caseId",
          "campus",
          "requestId",
          "reason",
          "expectedHead",
          "responsibilityId"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "expectedHead": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]*)$"
          },
          "responsibilityId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "recordDepartmentImpactDisposition": {
      "path": "/api/vnext/department-impacts/dispositions",
      "schema": {
        "type": "object",
        "required": [
          "caseId",
          "campus",
          "requestId",
          "reason",
          "expectedHead",
          "disposition"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "expectedHead": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]*)$"
          },
          "disposition": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "kind",
                  "evidenceId"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "KEEP_HISTORY"
                    ]
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "kind",
                  "evidenceId",
                  "result"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "CLOSE_RELATION"
                    ]
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "result": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "versionId",
                      "candidateId",
                      "requestId"
                    ],
                    "properties": {
                      "owner": {
                        "enum": [
                          "SOURCE_MAPPING",
                          "IDENTIFIER",
                          "HIERARCHY",
                          "CAMPUS_RELATION",
                          "BUSINESS_UNIT",
                          "NURSING_UNIT",
                          "WARD"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "versionId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "candidateId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "kind",
                  "evidenceId",
                  "result",
                  "oldRelation"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "NEW_RELATION"
                    ]
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "result": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "versionId",
                      "candidateId",
                      "requestId"
                    ],
                    "properties": {
                      "owner": {
                        "enum": [
                          "SOURCE_MAPPING",
                          "IDENTIFIER",
                          "HIERARCHY",
                          "CAMPUS_RELATION",
                          "BUSINESS_UNIT",
                          "NURSING_UNIT",
                          "WARD"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "versionId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "candidateId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "requestId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "oldRelation": {
                    "anyOf": [
                      {
                        "type": "object",
                        "required": [
                          "kind"
                        ],
                        "properties": {
                          "kind": {
                            "type": "string",
                            "enum": [
                              "KEEP_HISTORY"
                            ]
                          }
                        },
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "required": [
                          "kind",
                          "result"
                        ],
                        "properties": {
                          "kind": {
                            "type": "string",
                            "enum": [
                              "CLOSE"
                            ]
                          },
                          "result": {
                            "type": "object",
                            "required": [
                              "owner",
                              "id",
                              "versionId",
                              "candidateId",
                              "requestId"
                            ],
                            "properties": {
                              "owner": {
                                "enum": [
                                  "SOURCE_MAPPING",
                                  "IDENTIFIER",
                                  "HIERARCHY",
                                  "CAMPUS_RELATION",
                                  "BUSINESS_UNIT",
                                  "NURSING_UNIT",
                                  "WARD"
                                ]
                              },
                              "id": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                              },
                              "versionId": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                              },
                              "candidateId": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                              },
                              "requestId": {
                                "type": "string",
                                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                              }
                            },
                            "additionalProperties": false
                          }
                        },
                        "additionalProperties": false
                      }
                    ]
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "kind",
                  "evidenceId",
                  "consumers"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "MIGRATE_EXTERNAL"
                    ]
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "consumers": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "minItems": 1,
                    "maxItems": 20,
                    "uniqueItems": true
                  }
                },
                "additionalProperties": false
              }
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "approveDepartmentImpactDisposition": {
      "path": "/api/vnext/department-impacts/dispositions/approve",
      "schema": {
        "type": "object",
        "required": [
          "caseId",
          "campus",
          "requestId",
          "reason",
          "expectedHead",
          "proposalEventId"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "expectedHead": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]*)$"
          },
          "proposalEventId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "recheckDepartmentImpact": {
      "path": "/api/vnext/department-impacts/recheck",
      "schema": {
        "type": "object",
        "required": [
          "caseId",
          "campus",
          "requestId",
          "reason",
          "expectedHead"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "expectedHead": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]*)$"
          }
        },
        "additionalProperties": false
      }
    },
    "recordDepartmentMigrationReceipt": {
      "path": "/api/vnext/department-impacts/receipts",
      "schema": {
        "type": "object",
        "required": [
          "caseId",
          "campus",
          "requestId",
          "reason",
          "expectedHead",
          "proposalEventId",
          "consumerActor",
          "outcome",
          "receiptRef",
          "simulated"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "expectedHead": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]*)$"
          },
          "proposalEventId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "consumerActor": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "outcome": {
            "enum": [
              "FAILED",
              "PARTIAL",
              "SIMULATED_COMPLETED"
            ]
          },
          "receiptRef": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000,
            "pattern": "\\S"
          },
          "simulated": {
            "type": "boolean",
            "enum": [
              true
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "readDepartmentMigrationHandoff": {
      "path": "/api/vnext/department-impacts/handoffs/read",
      "schema": {
        "type": "object",
        "required": [
          "caseId",
          "campus"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "stageDepartmentLifecycle": {
      "path": "/api/vnext/department-lifecycle/inputs",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "jobId",
          "revisionId",
          "campus",
          "profile",
          "commands",
          "impacts"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "jobId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "revisionId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "campus": {
            "enum": [
              "NORTH",
              "SOUTH"
            ]
          },
          "profile": {
            "enum": [
              "CORE",
              "FULL"
            ]
          },
          "commands": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "object",
                  "required": [
                    "department",
                    "reason",
                    "evidenceId",
                    "action",
                    "effectiveAt"
                  ],
                  "properties": {
                    "department": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion",
                        "expectedLifecycleHead"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        },
                        "expectedLifecycleHead": {
                          "type": "string",
                          "pattern": "^[0-9]+$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "action": {
                      "enum": [
                        "SUSPEND",
                        "RESUME",
                        "DEPRECATE"
                      ]
                    },
                    "effectiveAt": {
                      "type": "string",
                      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                    }
                  },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "department",
                    "reason",
                    "evidenceId",
                    "campus",
                    "subject",
                    "action",
                    "services",
                    "validFrom",
                    "validTo"
                  ],
                  "properties": {
                    "department": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion",
                        "expectedLifecycleHead"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        },
                        "expectedLifecycleHead": {
                          "type": "string",
                          "pattern": "^[0-9]+$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "campus": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "organization-master/campus"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "subject": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "organization-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "action": {
                      "type": "string",
                      "enum": [
                        "ASSIGN"
                      ]
                    },
                    "services": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64
                      },
                      "minItems": 1,
                      "maxItems": 100,
                      "uniqueItems": true
                    },
                    "validFrom": {
                      "type": "string",
                      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                    },
                    "validTo": {
                      "anyOf": [
                        {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "department",
                    "reason",
                    "evidenceId",
                    "action",
                    "relation",
                    "services",
                    "validFrom",
                    "validTo"
                  ],
                  "properties": {
                    "department": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion",
                        "expectedLifecycleHead"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        },
                        "expectedLifecycleHead": {
                          "type": "string",
                          "pattern": "^[0-9]+$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "action": {
                      "enum": [
                        "REVISE",
                        "END"
                      ]
                    },
                    "relation": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master/campus-relation"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "services": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64
                      },
                      "minItems": 1,
                      "maxItems": 100,
                      "uniqueItems": true
                    },
                    "validFrom": {
                      "type": "string",
                      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                    },
                    "validTo": {
                      "anyOf": [
                        {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": [
                    "department",
                    "reason",
                    "evidenceId",
                    "action",
                    "relation",
                    "destination",
                    "services",
                    "effectiveAt"
                  ],
                  "properties": {
                    "department": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion",
                        "expectedLifecycleHead"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        },
                        "expectedLifecycleHead": {
                          "type": "string",
                          "pattern": "^[0-9]+$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000
                    },
                    "evidenceId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "action": {
                      "type": "string",
                      "enum": [
                        "MOVE"
                      ]
                    },
                    "relation": {
                      "type": "object",
                      "required": [
                        "owner",
                        "id",
                        "expectedVersion"
                      ],
                      "properties": {
                        "owner": {
                          "type": "string",
                          "enum": [
                            "department-master/campus-relation"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                        },
                        "expectedVersion": {
                          "type": "string",
                          "pattern": "^[1-9][0-9]*$"
                        }
                      },
                      "additionalProperties": false
                    },
                    "destination": {
                      "type": "object",
                      "required": [
                        "campus",
                        "subject"
                      ],
                      "properties": {
                        "campus": {
                          "type": "object",
                          "required": [
                            "owner",
                            "id"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "organization-master/campus"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            }
                          },
                          "additionalProperties": false
                        },
                        "subject": {
                          "type": "object",
                          "required": [
                            "owner",
                            "id"
                          ],
                          "properties": {
                            "owner": {
                              "type": "string",
                              "enum": [
                                "organization-master"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            }
                          },
                          "additionalProperties": false
                        }
                      },
                      "additionalProperties": false
                    },
                    "services": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64
                      },
                      "minItems": 1,
                      "maxItems": 100,
                      "uniqueItems": true
                    },
                    "effectiveAt": {
                      "type": "string",
                      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                    }
                  },
                  "additionalProperties": false
                }
              ]
            },
            "minItems": 1,
            "maxItems": 100
          },
          "impacts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "domain",
                "determination",
                "ownerRole",
                "ownerSignatory",
                "ownerDecisionRef",
                "requiredAction",
                "reason",
                "evidenceId"
              ],
              "properties": {
                "domain": {
                  "enum": [
                    "PERSONNEL",
                    "PATIENT",
                    "ACCOUNT",
                    "INVENTORY",
                    "FINANCE",
                    "SOURCE_MAPPING",
                    "HIERARCHY",
                    "CONSUMER",
                    "IDENTIFIER",
                    "WARD"
                  ]
                },
                "determination": {
                  "enum": [
                    "AFFECTED",
                    "UNAFFECTED",
                    "UNKNOWN"
                  ]
                },
                "ownerRole": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "\\S"
                },
                "ownerSignatory": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "\\S"
                },
                "ownerDecisionRef": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256,
                  "pattern": "\\S"
                },
                "requiredAction": {
                  "type": "string",
                  "maxLength": 2000
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            "minItems": 10,
            "maxItems": 10
          }
        },
        "additionalProperties": false
      }
    },
    "readDepartmentLifecycleInput": {
      "path": "/api/vnext/department-lifecycle/inputs/read",
      "schema": {
        "type": "object",
        "required": [
          "inputId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "verifyDepartmentLifecycle": {
      "path": "/api/vnext/department-lifecycle/verify",
      "schema": {
        "type": "object",
        "required": [
          "requestId",
          "inputId",
          "inputDigest",
          "reason",
          "policyApproved",
          "materialsAccepted",
          "impactReviews"
        ],
        "properties": {
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "inputDigest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "policyApproved": {
            "type": "boolean"
          },
          "materialsAccepted": {
            "type": "boolean"
          },
          "impactReviews": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "domain",
                "ownerAttestationAccepted",
                "dispositionAccepted",
                "reason"
              ],
              "properties": {
                "domain": {
                  "enum": [
                    "PERSONNEL",
                    "PATIENT",
                    "ACCOUNT",
                    "INVENTORY",
                    "FINANCE",
                    "SOURCE_MAPPING",
                    "HIERARCHY",
                    "CONSUMER",
                    "IDENTIFIER",
                    "WARD"
                  ]
                },
                "ownerAttestationAccepted": {
                  "type": "boolean"
                },
                "dispositionAccepted": {
                  "type": "boolean"
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000,
                  "pattern": "\\S"
                }
              },
              "additionalProperties": false
            },
            "minItems": 10,
            "maxItems": 10
          }
        },
        "additionalProperties": false
      }
    },
    "planDepartmentLifecycle": {
      "path": "/api/vnext/department-lifecycle/plan",
      "schema": {
        "type": "object",
        "required": [
          "inputId",
          "requestId"
        ],
        "properties": {
          "inputId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "reviewDepartmentLifecycle": {
      "path": "/api/vnext/department-lifecycle/review",
      "schema": {
        "type": "object",
        "required": [
          "candidateId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9-]{36}$"
          }
        },
        "additionalProperties": false
      }
    },
    "approveDepartmentLifecycle": {
      "path": "/api/vnext/department-lifecycle/approve",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "digest"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "additionalProperties": false
      }
    },
    "applyDepartmentLifecycle": {
      "path": "/api/vnext/department-lifecycle/apply",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "resumeDepartmentLifecycleOutcome": {
      "path": "/api/vnext/department-lifecycle/resume",
      "schema": {
        "type": "object",
        "required": [
          "candidateId",
          "requestId"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "requestId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          }
        },
        "additionalProperties": false
      }
    },
    "getDepartmentLifecycleHistory": {
      "path": "/api/vnext/department-lifecycle/history",
      "schema": {
        "type": "object",
        "required": [
          "id"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "getDepartmentLifecycleAsOf": {
      "path": "/api/vnext/department-lifecycle/query",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "businessAt"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    },
    "listDepartmentCampusRelations": {
      "path": "/api/vnext/department-lifecycle/relations",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "businessAt",
          "limit"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "businessAt": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "campusId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "afterId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          }
        },
        "additionalProperties": false
      }
    },
    "diffDepartmentCampusRelation": {
      "path": "/api/vnext/department-lifecycle/relations/diff",
      "schema": {
        "type": "object",
        "required": [
          "departmentId",
          "relationId",
          "fromVersion",
          "toVersion"
        ],
        "properties": {
          "departmentId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "relationId": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "fromVersion": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$"
          },
          "toVersion": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$"
          }
        },
        "additionalProperties": false
      }
    },
    "getDepartmentAdmissionWindow": {
      "path": "/api/vnext/department-lifecycle/admission",
      "schema": {
        "type": "object",
        "required": [
          "id",
          "validFrom",
          "validTo"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
          },
          "validFrom": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          },
          "validTo": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
              },
              {
                "type": "null"
              }
            ]
          },
          "recordAsOf": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
          }
        },
        "additionalProperties": false
      }
    }
  },
  "drafts": {
    "DEPARTMENT": {
      "type": "object",
      "required": [
        "timePolicy",
        "entries"
      ],
      "properties": {
        "timePolicy": {
          "enum": [
            "SOURCE_OFFSET_08",
            "LOCAL"
          ]
        },
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "row",
              "intent",
              "target",
              "origin",
              "evidenceId"
            ],
            "properties": {
              "row": {
                "type": "object",
                "required": [
                  "org_id",
                  "org_code",
                  "org_name",
                  "org_short_name",
                  "org_type",
                  "established_on",
                  "abolished_on",
                  "establishment_doc",
                  "description",
                  "is_virtual",
                  "version_no",
                  "valid_from",
                  "valid_to",
                  "record_status",
                  "source_system_id",
                  "source_record_id",
                  "approval_ref",
                  "recorded_at"
                ],
                "properties": {
                  "org_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "org_code": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "org_name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "pattern": "\\S"
                  },
                  "org_short_name": {
                    "type": "string",
                    "maxLength": 160
                  },
                  "org_type": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "established_on": {
                    "type": "string",
                    "maxLength": 10
                  },
                  "abolished_on": {
                    "type": "string",
                    "maxLength": 10
                  },
                  "establishment_doc": {
                    "type": "string",
                    "maxLength": 256
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "is_virtual": {
                    "enum": [
                      "Y",
                      "N"
                    ]
                  },
                  "version_no": {
                    "type": "string",
                    "pattern": "^[1-9][0-9]*$"
                  },
                  "valid_from": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 40,
                    "pattern": "\\S"
                  },
                  "valid_to": {
                    "type": "string",
                    "maxLength": 40
                  },
                  "record_status": {
                    "enum": [
                      "DRAFT",
                      "REVIEW",
                      "ACTIVE",
                      "SUSPENDED",
                      "RETIRED"
                    ]
                  },
                  "source_system_id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "source_record_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "approval_ref": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "recorded_at": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 40,
                    "pattern": "\\S"
                  }
                },
                "additionalProperties": false
              },
              "intent": {
                "enum": [
                  "CREATE",
                  "REVISE"
                ]
              },
              "target": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "maxLength": 19,
                        "pattern": "^[1-9][0-9]{0,18}$"
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "origin": {
                "enum": [
                  "NEW",
                  "HISTORICAL"
                ]
              },
              "evidenceId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 100
        },
        "sourceArtifactId": {
          "type": "string",
          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
        }
      },
      "additionalProperties": false
    },
    "HIERARCHY": {
      "type": "object",
      "required": [
        "viewId",
        "sourceClientKey",
        "viewCode",
        "viewName",
        "viewType",
        "parentCardinality",
        "purpose",
        "aggregationRule",
        "ownerDepartmentId",
        "sourceSystemId",
        "sourceRecordId",
        "sourceVersion",
        "validFrom",
        "validTo",
        "recordedAt",
        "recordStatus",
        "approvalRef",
        "nodes"
      ],
      "properties": {
        "dependencies": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "dataset",
              "contractId",
              "contractVersionId"
            ],
            "properties": {
              "dataset": {
                "enum": [
                  "ORG05",
                  "ORG06"
                ]
              },
              "contractId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "contractVersionId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          },
          "maxItems": 2
        },
        "viewId": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "sourceClientKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128,
          "pattern": "\\S"
        },
        "viewCode": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "\\S"
        },
        "viewName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "\\S"
        },
        "viewType": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "ADMINISTRATIVE"
              ]
            },
            {
              "type": "string",
              "enum": [
                "OPERATIONAL"
              ]
            },
            {
              "type": "string",
              "enum": [
                "MEDICAL_RECORD"
              ]
            },
            {
              "type": "string",
              "enum": [
                "FINANCE"
              ]
            },
            {
              "type": "string",
              "enum": [
                "STATISTICAL"
              ]
            }
          ]
        },
        "parentCardinality": {
          "type": "string",
          "enum": [
            "STRICT_TREE"
          ]
        },
        "purpose": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "pattern": "\\S"
        },
        "aggregationRule": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "pattern": "\\S"
        },
        "ownerDepartmentId": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "sourceSystemId": {
          "type": "string",
          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
        },
        "sourceRecordId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "\\S"
        },
        "sourceVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "\\S"
        },
        "validFrom": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
        },
        "validTo": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
            },
            {
              "type": "null"
            }
          ]
        },
        "recordedAt": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
        },
        "recordStatus": {
          "type": "string",
          "enum": [
            "ACTIVE"
          ]
        },
        "approvalRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "\\S"
        },
        "nodes": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "sourceEvidence",
                  "nodeKey",
                  "parentNodeKey",
                  "nodeKind",
                  "departmentId",
                  "departmentVersionId",
                  "displayName",
                  "relationName",
                  "sortOrder",
                  "isPrimaryPath"
                ],
                "properties": {
                  "sourceEvidence": {
                    "type": "object",
                    "required": [
                      "sourceClientKey",
                      "sourceVersion",
                      "sourceSystemId",
                      "sourceRecordId",
                      "validFrom",
                      "validTo",
                      "recordedAt",
                      "recordStatus",
                      "approvalRef"
                    ],
                    "properties": {
                      "sourceClientKey": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 128,
                        "pattern": "\\S"
                      },
                      "sourceVersion": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64,
                        "pattern": "\\S"
                      },
                      "sourceSystemId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "sourceRecordId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256,
                        "pattern": "\\S"
                      },
                      "validFrom": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                      },
                      "validTo": {
                        "anyOf": [
                          {
                            "type": "string",
                            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "recordedAt": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                      },
                      "recordStatus": {
                        "type": "string",
                        "enum": [
                          "ACTIVE"
                        ]
                      },
                      "approvalRef": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256,
                        "pattern": "\\S"
                      }
                    },
                    "additionalProperties": false
                  },
                  "nodeKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128,
                    "pattern": "\\S"
                  },
                  "parentNodeKey": {
                    "anyOf": [
                      {
                        "type": "string",
                        "maxLength": 128
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "nodeKind": {
                    "type": "string",
                    "enum": [
                      "DEPARTMENT"
                    ]
                  },
                  "departmentId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "departmentVersionId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "displayName": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "relationName": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128,
                    "pattern": "\\S"
                  },
                  "sortOrder": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483647
                  },
                  "isPrimaryPath": {
                    "type": "boolean"
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "sourceEvidence",
                  "nodeKey",
                  "parentNodeKey",
                  "nodeKind",
                  "groupCode",
                  "groupId",
                  "groupVersionId",
                  "displayName",
                  "relationName",
                  "sortOrder",
                  "isPrimaryPath"
                ],
                "properties": {
                  "sourceEvidence": {
                    "type": "object",
                    "required": [
                      "sourceClientKey",
                      "sourceVersion",
                      "sourceSystemId",
                      "sourceRecordId",
                      "validFrom",
                      "validTo",
                      "recordedAt",
                      "recordStatus",
                      "approvalRef"
                    ],
                    "properties": {
                      "sourceClientKey": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 128,
                        "pattern": "\\S"
                      },
                      "sourceVersion": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64,
                        "pattern": "\\S"
                      },
                      "sourceSystemId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "sourceRecordId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256,
                        "pattern": "\\S"
                      },
                      "validFrom": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                      },
                      "validTo": {
                        "anyOf": [
                          {
                            "type": "string",
                            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "recordedAt": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$"
                      },
                      "recordStatus": {
                        "type": "string",
                        "enum": [
                          "ACTIVE"
                        ]
                      },
                      "approvalRef": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256,
                        "pattern": "\\S"
                      }
                    },
                    "additionalProperties": false
                  },
                  "nodeKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128,
                    "pattern": "\\S"
                  },
                  "parentNodeKey": {
                    "anyOf": [
                      {
                        "type": "string",
                        "maxLength": 128
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "nodeKind": {
                    "type": "string",
                    "enum": [
                      "GROUP"
                    ]
                  },
                  "groupCode": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128,
                    "pattern": "\\S"
                  },
                  "groupId": {
                    "anyOf": [
                      {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "groupVersionId": {
                    "anyOf": [
                      {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "displayName": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "relationName": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128,
                    "pattern": "\\S"
                  },
                  "sortOrder": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483647
                  },
                  "isPrimaryPath": {
                    "type": "boolean"
                  }
                },
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1,
          "maxItems": 100
        }
      },
      "additionalProperties": false
    },
    "MAPPING": {
      "type": "object",
      "required": [
        "entries"
      ],
      "properties": {
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "action",
              "mapping",
              "reason",
              "evidenceId",
              "row"
            ],
            "properties": {
              "action": {
                "enum": [
                  "REGISTER",
                  "CORRECT",
                  "RETRACT"
                ]
              },
              "mapping": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedHead"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master/organization-mapping"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedHead": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]{0,18}$",
                        "maxLength": 19
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "evidenceId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "row": {
                "type": "object",
                "required": [
                  "org_map_id",
                  "from_system_id",
                  "source_entity_type",
                  "source_code",
                  "source_name",
                  "source_context",
                  "target_type",
                  "target_id",
                  "mapping_relation",
                  "resolution_rule",
                  "verified_by",
                  "version_no",
                  "valid_from",
                  "valid_to",
                  "record_status",
                  "source_system_id",
                  "source_record_id",
                  "approval_ref",
                  "recorded_at"
                ],
                "properties": {
                  "org_map_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "from_system_id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "source_entity_type": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "source_code": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "source_name": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "source_context": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "target_type": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "target_id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "mapping_relation": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "resolution_rule": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "verified_by": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "version_no": {
                    "type": "string",
                    "pattern": "^[1-9][0-9]{0,9}$"
                  },
                  "valid_from": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 26,
                    "pattern": "\\S"
                  },
                  "valid_to": {
                    "type": "string",
                    "maxLength": 26
                  },
                  "record_status": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "source_system_id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "source_record_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "approval_ref": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "recorded_at": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 26,
                    "pattern": "\\S"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 100
        }
      },
      "additionalProperties": false
    },
    "IDENTIFIER": {
      "type": "object",
      "required": [
        "entries"
      ],
      "properties": {
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "action",
              "identifier",
              "reason",
              "evidenceId",
              "row"
            ],
            "properties": {
              "action": {
                "enum": [
                  "REGISTER",
                  "CORRECT",
                  "END",
                  "RETRACT",
                  "CHANGE"
                ]
              },
              "identifier": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedHead"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master/organization-identifier"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedHead": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]{0,18}$",
                        "maxLength": 19
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "evidenceId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "row": {
                "type": "object",
                "required": [
                  "org_identifier_id",
                  "target_type",
                  "target_id",
                  "identifier_kind",
                  "identifier_system",
                  "identifier_value",
                  "language",
                  "is_preferred",
                  "version_no",
                  "valid_from",
                  "valid_to",
                  "record_status",
                  "source_system_id",
                  "source_record_id",
                  "approval_ref",
                  "recorded_at"
                ],
                "properties": {
                  "org_identifier_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "target_type": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "target_id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "identifier_kind": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "identifier_system": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "identifier_value": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "language": {
                    "type": "string",
                    "maxLength": 64
                  },
                  "is_preferred": {
                    "enum": [
                      "Y",
                      "N"
                    ]
                  },
                  "version_no": {
                    "type": "string",
                    "pattern": "^[1-9][0-9]{0,9}$"
                  },
                  "valid_from": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 26,
                    "pattern": "\\S"
                  },
                  "valid_to": {
                    "type": "string",
                    "maxLength": 26
                  },
                  "record_status": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "source_system_id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "source_record_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "approval_ref": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "recorded_at": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 26,
                    "pattern": "\\S"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 100
        }
      },
      "additionalProperties": false
    },
    "EVOLUTION": {
      "type": "object",
      "required": [
        "event",
        "relations",
        "predecessors",
        "successors",
        "rename",
        "contracts",
        "sourceSystemId",
        "decisionEvidenceId",
        "migrationEvidenceId",
        "contextEvidenceId",
        "impacts"
      ],
      "properties": {
        "campusChanges": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "action",
                  "departmentId",
                  "relation"
                ],
                "properties": {
                  "action": {
                    "type": "string",
                    "enum": [
                      "END"
                    ]
                  },
                  "departmentId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "relation": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master/campus-relation"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]*$"
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "action",
                  "department",
                  "campus",
                  "subject",
                  "services",
                  "validTo"
                ],
                "properties": {
                  "action": {
                    "type": "string",
                    "enum": [
                      "ASSIGN"
                    ]
                  },
                  "department": {
                    "anyOf": [
                      {
                        "type": "object",
                        "required": [
                          "owner",
                          "id"
                        ],
                        "properties": {
                          "owner": {
                            "type": "string",
                            "enum": [
                              "department-master"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                          }
                        },
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "required": [
                          "owner",
                          "alias"
                        ],
                        "properties": {
                          "owner": {
                            "type": "string",
                            "enum": [
                              "department-master/evolution-successor"
                            ]
                          },
                          "alias": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 64
                          }
                        },
                        "additionalProperties": false
                      }
                    ]
                  },
                  "campus": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "organization-master/campus"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "subject": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "organization-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "services": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64
                    },
                    "minItems": 1,
                    "maxItems": 100,
                    "uniqueItems": true
                  },
                  "validTo": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                },
                "additionalProperties": false
              }
            ]
          },
          "maxItems": 100
        },
        "compensatesEvent": {
          "type": "object",
          "required": [
            "owner",
            "id",
            "version"
          ],
          "properties": {
            "owner": {
              "type": "string",
              "enum": [
                "department-master/organization-evolution"
              ]
            },
            "id": {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            "version": {
              "type": "string",
              "enum": [
                "1"
              ]
            }
          },
          "additionalProperties": false
        },
        "event": {
          "type": "object",
          "required": [
            "org_event_id",
            "change_type",
            "effective_at",
            "decision_ref",
            "reason",
            "historical_reporting_rule",
            "migration_plan_ref",
            "recorded_at"
          ],
          "properties": {
            "org_event_id": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64,
              "pattern": "\\S"
            },
            "change_type": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64,
              "pattern": "\\S"
            },
            "effective_at": {
              "type": "string",
              "minLength": 1,
              "maxLength": 40,
              "pattern": "\\S"
            },
            "decision_ref": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256,
              "pattern": "\\S"
            },
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2000,
              "pattern": "\\S"
            },
            "historical_reporting_rule": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2000,
              "pattern": "\\S"
            },
            "migration_plan_ref": {
              "type": "string",
              "maxLength": 256
            },
            "recorded_at": {
              "type": "string",
              "minLength": 1,
              "maxLength": 40,
              "pattern": "\\S"
            }
          },
          "additionalProperties": false
        },
        "relations": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "succession_id",
              "org_event_id",
              "from_target_type",
              "from_target_id",
              "to_target_type",
              "to_target_id",
              "transfer_scope",
              "context_rule",
              "recorded_at"
            ],
            "properties": {
              "succession_id": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "\\S"
              },
              "org_event_id": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "pattern": "\\S"
              },
              "from_target_type": {
                "type": "string",
                "maxLength": 64
              },
              "from_target_id": {
                "type": "string",
                "maxLength": 64
              },
              "to_target_type": {
                "type": "string",
                "maxLength": 64
              },
              "to_target_id": {
                "type": "string",
                "maxLength": 64
              },
              "transfer_scope": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "context_rule": {
                "type": "string",
                "maxLength": 2000
              },
              "recorded_at": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40,
                "pattern": "\\S"
              }
            },
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 100
        },
        "predecessors": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "owner",
              "id",
              "expectedVersion"
            ],
            "properties": {
              "owner": {
                "type": "string",
                "enum": [
                  "department-master"
                ]
              },
              "id": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              },
              "expectedVersion": {
                "type": "string",
                "maxLength": 19,
                "pattern": "^[1-9][0-9]{0,18}$"
              }
            },
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 100
        },
        "successors": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "row",
              "intent",
              "target",
              "origin",
              "evidenceId"
            ],
            "properties": {
              "row": {
                "type": "object",
                "required": [
                  "org_id",
                  "org_code",
                  "org_name",
                  "org_short_name",
                  "org_type",
                  "established_on",
                  "abolished_on",
                  "establishment_doc",
                  "description",
                  "is_virtual",
                  "version_no",
                  "valid_from",
                  "valid_to",
                  "record_status",
                  "source_system_id",
                  "source_record_id",
                  "approval_ref",
                  "recorded_at"
                ],
                "properties": {
                  "org_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "org_code": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "org_name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "pattern": "\\S"
                  },
                  "org_short_name": {
                    "type": "string",
                    "maxLength": 160
                  },
                  "org_type": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64,
                    "pattern": "\\S"
                  },
                  "established_on": {
                    "type": "string",
                    "maxLength": 10
                  },
                  "abolished_on": {
                    "type": "string",
                    "maxLength": 10
                  },
                  "establishment_doc": {
                    "type": "string",
                    "maxLength": 256
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "is_virtual": {
                    "enum": [
                      "Y",
                      "N"
                    ]
                  },
                  "version_no": {
                    "type": "string",
                    "pattern": "^[1-9][0-9]*$"
                  },
                  "valid_from": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 40,
                    "pattern": "\\S"
                  },
                  "valid_to": {
                    "type": "string",
                    "maxLength": 40
                  },
                  "record_status": {
                    "enum": [
                      "DRAFT",
                      "REVIEW",
                      "ACTIVE",
                      "SUSPENDED",
                      "RETIRED"
                    ]
                  },
                  "source_system_id": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "source_record_id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 256,
                    "pattern": "\\S"
                  },
                  "approval_ref": {
                    "type": "string",
                    "maxLength": 2000
                  },
                  "recorded_at": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 40,
                    "pattern": "\\S"
                  }
                },
                "additionalProperties": false
              },
              "intent": {
                "enum": [
                  "CREATE",
                  "REVISE"
                ]
              },
              "target": {
                "anyOf": [
                  {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "maxLength": 19,
                        "pattern": "^[1-9][0-9]{0,18}$"
                      }
                    },
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "origin": {
                "enum": [
                  "NEW",
                  "HISTORICAL"
                ]
              },
              "evidenceId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          },
          "maxItems": 100
        },
        "rename": {
          "anyOf": [
            {
              "type": "object",
              "required": [
                "name",
                "shortName"
              ],
              "properties": {
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "\\S"
                },
                "shortName": {
                  "type": "string",
                  "maxLength": 160
                }
              },
              "additionalProperties": false
            },
            {
              "type": "null"
            }
          ]
        },
        "contracts": {
          "type": "object",
          "required": [
            "successionContractId",
            "successionContractVersionId",
            "departmentContractId",
            "departmentContractVersionId"
          ],
          "properties": {
            "successionContractId": {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            "successionContractVersionId": {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            "departmentContractId": {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            "departmentContractVersionId": {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            }
          },
          "additionalProperties": false
        },
        "sourceSystemId": {
          "type": "string",
          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
        },
        "decisionEvidenceId": {
          "type": "string",
          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
        },
        "migrationEvidenceId": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "contextEvidenceId": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "impacts": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "domain",
              "determination",
              "ownerRole",
              "ownerSignatory",
              "ownerDecisionRef",
              "requiredAction",
              "reason",
              "evidenceId"
            ],
            "properties": {
              "domain": {
                "enum": [
                  "PERSONNEL",
                  "PATIENT",
                  "ACCOUNT",
                  "INVENTORY",
                  "FINANCE",
                  "SOURCE_MAPPING",
                  "HIERARCHY",
                  "CONSUMER",
                  "IDENTIFIER",
                  "WARD"
                ]
              },
              "determination": {
                "enum": [
                  "AFFECTED",
                  "UNAFFECTED",
                  "UNKNOWN"
                ]
              },
              "ownerRole": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160,
                "pattern": "\\S"
              },
              "ownerSignatory": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160,
                "pattern": "\\S"
              },
              "ownerDecisionRef": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "\\S"
              },
              "requiredAction": {
                "type": "string",
                "maxLength": 2000
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "evidenceId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          },
          "minItems": 10,
          "maxItems": 10
        }
      },
      "additionalProperties": false
    },
    "LIFECYCLE": {
      "type": "object",
      "required": [
        "commands",
        "impacts"
      ],
      "properties": {
        "commands": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "required": [
                  "department",
                  "reason",
                  "evidenceId",
                  "action",
                  "effectiveAt"
                ],
                "properties": {
                  "department": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion",
                      "expectedLifecycleHead"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]*$"
                      },
                      "expectedLifecycleHead": {
                        "type": "string",
                        "pattern": "^[0-9]+$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "action": {
                    "enum": [
                      "SUSPEND",
                      "RESUME",
                      "DEPRECATE"
                    ]
                  },
                  "effectiveAt": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "department",
                  "reason",
                  "evidenceId",
                  "campus",
                  "subject",
                  "action",
                  "services",
                  "validFrom",
                  "validTo"
                ],
                "properties": {
                  "department": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion",
                      "expectedLifecycleHead"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]*$"
                      },
                      "expectedLifecycleHead": {
                        "type": "string",
                        "pattern": "^[0-9]+$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "campus": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "organization-master/campus"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "subject": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "organization-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "action": {
                    "type": "string",
                    "enum": [
                      "ASSIGN"
                    ]
                  },
                  "services": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64
                    },
                    "minItems": 1,
                    "maxItems": 100,
                    "uniqueItems": true
                  },
                  "validFrom": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                  },
                  "validTo": {
                    "anyOf": [
                      {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "department",
                  "reason",
                  "evidenceId",
                  "action",
                  "relation",
                  "services",
                  "validFrom",
                  "validTo"
                ],
                "properties": {
                  "department": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion",
                      "expectedLifecycleHead"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]*$"
                      },
                      "expectedLifecycleHead": {
                        "type": "string",
                        "pattern": "^[0-9]+$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "action": {
                    "enum": [
                      "REVISE",
                      "END"
                    ]
                  },
                  "relation": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master/campus-relation"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]*$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "services": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64
                    },
                    "minItems": 1,
                    "maxItems": 100,
                    "uniqueItems": true
                  },
                  "validFrom": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                  },
                  "validTo": {
                    "anyOf": [
                      {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                },
                "additionalProperties": false
              },
              {
                "type": "object",
                "required": [
                  "department",
                  "reason",
                  "evidenceId",
                  "action",
                  "relation",
                  "destination",
                  "services",
                  "effectiveAt"
                ],
                "properties": {
                  "department": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion",
                      "expectedLifecycleHead"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]*$"
                      },
                      "expectedLifecycleHead": {
                        "type": "string",
                        "pattern": "^[0-9]+$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000
                  },
                  "evidenceId": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                  },
                  "action": {
                    "type": "string",
                    "enum": [
                      "MOVE"
                    ]
                  },
                  "relation": {
                    "type": "object",
                    "required": [
                      "owner",
                      "id",
                      "expectedVersion"
                    ],
                    "properties": {
                      "owner": {
                        "type": "string",
                        "enum": [
                          "department-master/campus-relation"
                        ]
                      },
                      "id": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                      },
                      "expectedVersion": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]*$"
                      }
                    },
                    "additionalProperties": false
                  },
                  "destination": {
                    "type": "object",
                    "required": [
                      "campus",
                      "subject"
                    ],
                    "properties": {
                      "campus": {
                        "type": "object",
                        "required": [
                          "owner",
                          "id"
                        ],
                        "properties": {
                          "owner": {
                            "type": "string",
                            "enum": [
                              "organization-master/campus"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                          }
                        },
                        "additionalProperties": false
                      },
                      "subject": {
                        "type": "object",
                        "required": [
                          "owner",
                          "id"
                        ],
                        "properties": {
                          "owner": {
                            "type": "string",
                            "enum": [
                              "organization-master"
                            ]
                          },
                          "id": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                          }
                        },
                        "additionalProperties": false
                      }
                    },
                    "additionalProperties": false
                  },
                  "services": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 64
                    },
                    "minItems": 1,
                    "maxItems": 100,
                    "uniqueItems": true
                  },
                  "effectiveAt": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$"
                  }
                },
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1,
          "maxItems": 100
        },
        "impacts": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "domain",
              "determination",
              "ownerRole",
              "ownerSignatory",
              "ownerDecisionRef",
              "requiredAction",
              "reason",
              "evidenceId"
            ],
            "properties": {
              "domain": {
                "enum": [
                  "PERSONNEL",
                  "PATIENT",
                  "ACCOUNT",
                  "INVENTORY",
                  "FINANCE",
                  "SOURCE_MAPPING",
                  "HIERARCHY",
                  "CONSUMER",
                  "IDENTIFIER",
                  "WARD"
                ]
              },
              "determination": {
                "enum": [
                  "AFFECTED",
                  "UNAFFECTED",
                  "UNKNOWN"
                ]
              },
              "ownerRole": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160,
                "pattern": "\\S"
              },
              "ownerSignatory": {
                "type": "string",
                "minLength": 1,
                "maxLength": 160,
                "pattern": "\\S"
              },
              "ownerDecisionRef": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256,
                "pattern": "\\S"
              },
              "requiredAction": {
                "type": "string",
                "maxLength": 2000
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000,
                "pattern": "\\S"
              },
              "evidenceId": {
                "type": "string",
                "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
              }
            },
            "additionalProperties": false
          },
          "minItems": 10,
          "maxItems": 10
        }
      },
      "additionalProperties": false
    },
    "IMPACT": {
      "type": "object",
      "required": [
        "caseId",
        "reason",
        "expectedHead",
        "disposition"
      ],
      "properties": {
        "caseId": {
          "type": "string",
          "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "pattern": "\\S"
        },
        "expectedHead": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$"
        },
        "disposition": {
          "anyOf": [
            {
              "type": "object",
              "required": [
                "kind",
                "evidenceId"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "KEEP_HISTORY"
                  ]
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                }
              },
              "additionalProperties": false
            },
            {
              "type": "object",
              "required": [
                "kind",
                "evidenceId",
                "result"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "CLOSE_RELATION"
                  ]
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "result": {
                  "type": "object",
                  "required": [
                    "owner",
                    "id",
                    "versionId",
                    "candidateId",
                    "requestId"
                  ],
                  "properties": {
                    "owner": {
                      "enum": [
                        "SOURCE_MAPPING",
                        "IDENTIFIER",
                        "HIERARCHY",
                        "CAMPUS_RELATION",
                        "BUSINESS_UNIT",
                        "NURSING_UNIT",
                        "WARD"
                      ]
                    },
                    "id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "versionId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "candidateId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "requestId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "additionalProperties": false
            },
            {
              "type": "object",
              "required": [
                "kind",
                "evidenceId",
                "result",
                "oldRelation"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "NEW_RELATION"
                  ]
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "result": {
                  "type": "object",
                  "required": [
                    "owner",
                    "id",
                    "versionId",
                    "candidateId",
                    "requestId"
                  ],
                  "properties": {
                    "owner": {
                      "enum": [
                        "SOURCE_MAPPING",
                        "IDENTIFIER",
                        "HIERARCHY",
                        "CAMPUS_RELATION",
                        "BUSINESS_UNIT",
                        "NURSING_UNIT",
                        "WARD"
                      ]
                    },
                    "id": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "versionId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "candidateId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    },
                    "requestId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                    }
                  },
                  "additionalProperties": false
                },
                "oldRelation": {
                  "anyOf": [
                    {
                      "type": "object",
                      "required": [
                        "kind"
                      ],
                      "properties": {
                        "kind": {
                          "type": "string",
                          "enum": [
                            "KEEP_HISTORY"
                          ]
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "required": [
                        "kind",
                        "result"
                      ],
                      "properties": {
                        "kind": {
                          "type": "string",
                          "enum": [
                            "CLOSE"
                          ]
                        },
                        "result": {
                          "type": "object",
                          "required": [
                            "owner",
                            "id",
                            "versionId",
                            "candidateId",
                            "requestId"
                          ],
                          "properties": {
                            "owner": {
                              "enum": [
                                "SOURCE_MAPPING",
                                "IDENTIFIER",
                                "HIERARCHY",
                                "CAMPUS_RELATION",
                                "BUSINESS_UNIT",
                                "NURSING_UNIT",
                                "WARD"
                              ]
                            },
                            "id": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "versionId": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "candidateId": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            },
                            "requestId": {
                              "type": "string",
                              "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                            }
                          },
                          "additionalProperties": false
                        }
                      },
                      "additionalProperties": false
                    }
                  ]
                }
              },
              "additionalProperties": false
            },
            {
              "type": "object",
              "required": [
                "kind",
                "evidenceId",
                "consumers"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "MIGRATE_EXTERNAL"
                  ]
                },
                "evidenceId": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
                },
                "consumers": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "minItems": 1,
                  "maxItems": 20,
                  "uniqueItems": true
                }
              },
              "additionalProperties": false
            }
          ]
        }
      },
      "additionalProperties": false
    }
  }
} as const;
