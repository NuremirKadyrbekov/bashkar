#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <sqlite3.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#define MAX_SNAPSHOT_BYTES (256LL * 1024LL * 1024LL)

static int scalar(sqlite3 *db, const char *sql, int64_t *value) {
  sqlite3_stmt *stmt = NULL;
  int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
  if (rc == SQLITE_OK && sqlite3_step(stmt) == SQLITE_ROW) *value = sqlite3_column_int64(stmt, 0);
  else rc = SQLITE_ERROR;
  sqlite3_finalize(stmt);
  return rc;
}
static int healthy(sqlite3 *db) {
  sqlite3_stmt *stmt = NULL;
  int ok = 0;
  if (sqlite3_prepare_v2(db, "PRAGMA quick_check", -1, &stmt, NULL) != SQLITE_OK) return 0;
  if (sqlite3_step(stmt) == SQLITE_ROW && strcmp((const char *)sqlite3_column_text(stmt, 0), "ok") == 0 && sqlite3_step(stmt) == SQLITE_DONE) ok = 1;
  sqlite3_finalize(stmt);
  if (!ok) return 0;
  if (sqlite3_prepare_v2(db, "PRAGMA foreign_key_check", -1, &stmt, NULL) != SQLITE_OK) return 0;
  ok = sqlite3_step(stmt) == SQLITE_DONE;
  sqlite3_finalize(stmt);
  return ok;
}

int main(int argc, char **argv) {
  sqlite3 *source = NULL, *memory = NULL;
  sqlite3_backup *backup = NULL;
  unsigned char *snapshot = NULL;
  sqlite3_int64 size = 0, pages = 0, page_size = 0;
  int rc = 1;
  if (argc != 2) { fputs("RECOVERY_ARGUMENTS_INVALID\n", stderr); return 1; }
#ifdef _WIN32
  if (_setmode(_fileno(stdout), _O_BINARY) == -1) { fputs("RECOVERY_BINARY_STREAM_FAILED\n", stderr); return 1; }
#endif
  if (sqlite3_open_v2(argv[1], &source, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, NULL) != SQLITE_OK) goto fail;
  if (scalar(source, "PRAGMA page_count", &pages) != SQLITE_OK || scalar(source, "PRAGMA page_size", &page_size) != SQLITE_OK) goto fail;
  if (pages < 1 || page_size < 512 || pages > MAX_SNAPSHOT_BYTES / page_size) { fputs("RECOVERY_SNAPSHOT_TOO_LARGE\n", stderr); goto cleanup; }
  if (sqlite3_open_v2(":memory:", &memory, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL) != SQLITE_OK) goto fail;
  backup = sqlite3_backup_init(memory, "main", source, "main");
  if (!backup) goto fail;
  int result = sqlite3_backup_step(backup, -1);
  int finished = sqlite3_backup_finish(backup);
  backup = NULL;
  if (result != SQLITE_DONE || finished != SQLITE_OK) goto fail;
  if (!healthy(memory)) goto fail;
  snapshot = sqlite3_serialize(memory, "main", &size, 0);
  if (!snapshot || size < 1 || size > MAX_SNAPSHOT_BYTES) goto fail;
  for (sqlite3_int64 offset = 0; offset < size;) {
    size_t count = (size_t)((size - offset) > 65536 ? 65536 : (size - offset));
    if (fwrite(snapshot + offset, 1, count, stdout) != count) goto fail;
    offset += (sqlite3_int64)count;
  }
  if (fflush(stdout) != 0) goto fail;
  rc = 0;
  goto cleanup;
fail:
  fputs("RECOVERY_MEMORY_BACKUP_FAILED\n", stderr);
cleanup:
  if (backup) sqlite3_backup_finish(backup);
  if (snapshot) sqlite3_free(snapshot);
  if (memory) sqlite3_close(memory);
  if (source) sqlite3_close(source);
  return rc;
}
