resource "google_monitoring_dashboard" "sensor" {
  project        = local.project_id
  dashboard_json = <<-JSON
{
  "displayName": "Sensor ingestion and processing (${local.env})",
  "gridLayout": {
    "columns": "2",
    "widgets": [
      {
        "title": "Ingestion request p95 by revision (ms)",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_latencies\" AND resource.labels.service_name=\"cloudlink\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_95"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "Ingestion 503 responses",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND resource.labels.service_name=\"cloudlink\" AND metric.labels.response_code=\"503\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_SUM"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "Post-rollup dirty_hours (p99 bucket estimate)",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/telemetry_dirty_hours\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_99",
                    "crossSeriesReducer": "REDUCE_MAX"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "Post-rollup oldest_dirty_seconds (p99 bucket estimate)",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/telemetry_oldest_dirty_seconds\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_99",
                    "crossSeriesReducer": "REDUCE_MAX"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "Post-rollup default_rows (p99 bucket estimate)",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/telemetry_default_rows\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_99",
                    "crossSeriesReducer": "REDUCE_MAX"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "SQL connections by database",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\" AND resource.labels.database_id=\"${local.project_id}:${module.sql.instance_name}\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_MAX"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "SQL CPU utilization",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.labels.database_id=\"${local.project_id}:${module.sql.instance_name}\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_MEAN"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "SQL disk utilization",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/disk/utilization\" AND resource.labels.database_id=\"${local.project_id}:${module.sql.instance_name}\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_MEAN"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "SQL disk read operations/s",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/disk/read_ops_count\" AND resource.labels.database_id=\"${local.project_id}:${module.sql.instance_name}\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_RATE"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "SQL disk write operations/s",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/disk/write_ops_count\" AND resource.labels.database_id=\"${local.project_id}:${module.sql.instance_name}\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_RATE"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "Telemetry completed executions by job/result",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_job\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND (resource.labels.job_name=\"telemetry-rollup\" OR resource.labels.job_name=\"telemetry-maintain\")",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_SUM"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      },
      {
        "title": "Ingestion pool acquisition p95 (ms, success/failure)",
        "xyChart": {
          "dataSets": [
            {
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/ingest_pool_wait_ms\"",
                  "aggregation": {
                    "alignmentPeriod": "300s",
                    "perSeriesAligner": "ALIGN_PERCENTILE_95"
                  }
                }
              },
              "plotType": "LINE"
            }
          ],
          "yAxis": {
            "scale": "LINEAR"
          }
        }
      }
    ]
  }
}
JSON
  depends_on     = [google_logging_metric.telemetry_health, google_logging_metric.ingest_pool_wait]
}
