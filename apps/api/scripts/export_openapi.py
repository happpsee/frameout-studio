"""把接口契约写到 dist/openapi.json，供 BFF 生成 TypeScript 类型。"""

import json
from pathlib import Path

from frameout_api.main import app

output = Path(__file__).resolve().parent.parent / "dist" / "openapi.json"
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(output)
