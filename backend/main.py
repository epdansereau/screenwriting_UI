from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from screenwriting import Screenplay
import os, json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    contents = await file.read()
    path = f"temp{ext}"
    with open(path, "wb") as f:
        f.write(contents)

    if ext == ".fdx":
        screenplay = Screenplay.from_fdx(path)
    else:
        screenplay = Screenplay.from_plain(path, markdown=True)

    json_path = "screenplay.json"
    screenplay.save_as_json(json_path)

    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)
    
@app.get("/export")
async def export_script(type: str = Query(..., enum=["fdx", "txt", "txt-layout", "json"])):
    try:
        if not os.path.exists("screenplay.json"):
            return JSONResponse({"error": "No screenplay available. Upload a script first."}, status_code=400)

        with open("screenplay.json", "r", encoding="utf-8") as f:
            screenplay_data = json.load(f)
        screenplay = Screenplay._from_json(screenplay_data)

        if type == "fdx":
            file_path = "export.fdx"
            screenplay.save_as_fdx(file_path)
        elif type == "txt":
            file_path = "export.txt"
            screenplay.save_as_text(file_path, spacing=False)
        elif type == "txt-layout":
            file_path = "export_layout.txt"
            screenplay.save_as_text(file_path, spacing=True)
        elif type == "json":
            file_path = "export.json"
            screenplay.save_as_json(file_path)
        else:
            return JSONResponse({"error": "Invalid export type"}, status_code=400)

        return FileResponse(file_path, filename=os.path.basename(file_path), media_type="application/octet-stream")

    except Exception as e:
        print(f"[EXPORT ERROR] {e}")  # 👈 log to terminal
        return JSONResponse({"error": str(e)}, status_code=500)