import json
import os
import re
from io import BytesIO
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_PAGES = 500
MAX_TEXT_CHARS = 180_000

app = FastAPI(
    title="PaperLens API",
    description="Extract research methodology, datasets, and benchmark metrics from PDF papers.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

DATASET_NAMES = [
    "ImageNet", "CIFAR-10", "CIFAR-100", "MNIST", "Fashion-MNIST", "COCO",
    "MS COCO", "Pascal VOC", "VOC 2007", "VOC 2012", "SQuAD", "GLUE",
    "SuperGLUE", "WikiText", "LibriSpeech", "Common Voice", "MIMIC-III",
    "MIMIC-IV", "PubMed", "MNLI", "SNLI", "WMT14", "WMT16", "Cityscapes",
    "ADE20K", "Kinetics-400", "Kinetics-600", "UCF101", "YouTube-8M",
    "OpenImages", "CelebA", "Penn Treebank", "HumanEval", "MMLU", "GSM8K",
]
METRIC_NAMES = [
    ("F1 score", r"\bF1(?:[- ]score)?\b"),
    ("Accuracy", r"\baccuracy\b"),
    ("Precision", r"\bprecision\b"),
    ("Recall", r"\brecall\b"),
    ("AUC", r"\b(?:ROC[- ]?)?AUC\b"),
    ("BLEU", r"\bBLEU(?:[- ]?\d+)?\b"),
    ("ROUGE", r"\bROUGE(?:[- ]?(?:1|2|L))?\b"),
    ("mAP", r"\bmAP\b|\bmean average precision\b"),
    ("IoU", r"\b(?:mIoU|IoU)\b"),
    ("Perplexity", r"\bperplexity\b"),
    ("WER", r"\bWER\b|\bword error rate\b"),
    ("MAE", r"\bMAE\b|\bmean absolute error\b"),
    ("RMSE", r"\bRMSE\b|\broot mean squared error\b"),
    ("R²", r"\bR(?:\^?2|²)\b"),
    ("Exact match", r"\bexact match\b|\bEM\b"),
    ("Top-1 accuracy", r"\btop[- ]1(?: accuracy)?\b"),
    ("Top-5 accuracy", r"\btop[- ]5(?: accuracy)?\b"),
]


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "ai_enabled": bool(os.getenv("GEMINI_API_KEY"))}


@app.post("/api/analyze")
async def analyze_pdf(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    content = await file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 25 MB upload limit.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The uploaded file does not appear to be a valid PDF.")

    try:
        reader = PdfReader(BytesIO(content), strict=False)
        if reader.is_encrypted:
            raise HTTPException(status_code=422, detail="This PDF is password-protected and cannot be analyzed.")
        page_count = len(reader.pages)
        if page_count > MAX_PAGES:
            raise HTTPException(status_code=413, detail=f"PDF has {page_count} pages; the maximum supported is {MAX_PAGES}.")
        text_parts = []
        total_chars = 0
        for page in reader.pages:
            page_text = page.extract_text() or ""
            remaining = MAX_TEXT_CHARS - total_chars
            if remaining <= 0:
                break
            text_parts.append(page_text[:remaining])
            total_chars += min(len(page_text), remaining)
        text = "\n".join(text_parts).strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read the PDF: {exc}") from exc

    if len(text) < 80:
        raise HTTPException(
            status_code=422,
            detail="No readable text was found. The PDF may be scanned; OCR is not included in this prototype.",
        )

    metadata = reader.metadata or {}
    title = clean_metadata(getattr(metadata, "title", None))
    author = clean_metadata(getattr(metadata, "author", None))
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if api_key:
        extracted = extract_with_gemini(text, api_key)
        source = "gemini"
    else:
        extracted = extract_locally(text)
        source = "rules"

    extracted["paper_title"] = extracted.get("paper_title") or title or title_from_text(text) or file.filename
    extracted["author"] = extracted.get("author") or author or ""
    extracted["year"] = extracted.get("year") or find_year(text)
    extracted["page_count"] = page_count
    extracted["word_count"] = len(text.split())
    extracted["source"] = source
    extracted["verification_notes"] = normalize_string_list(extracted.get("verification_notes"))
    extracted["verification_notes"].append(
        "Confirm reported metric values and their dataset/split against the original tables; PDF text extraction may lose table structure."
    )
    if page_count > 0 and not extracted.get("metrics"):
        extracted["verification_notes"].append(
            "No benchmark values were confidently extracted. Check figures, tables, and supplementary material manually."
        )
    return extracted


def clean_metadata(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()


def title_from_text(text: str) -> str:
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if 15 <= len(line) <= 180 and not re.search(r"(?i)abstract|arxiv|proceedings|university", line):
            return line
    return ""


def find_year(text: str) -> str:
    match = re.search(r"\b(?:19|20)\d{2}\b", text[:8000])
    return match.group(0) if match else ""


def extract_locally(text: str) -> dict[str, Any]:
    normalized = re.sub(r"[ \t]+", " ", text)
    sections = split_sections(normalized)
    abstract = find_abstract(normalized)
    summary_basis = abstract or first_meaningful_paragraph(normalized)
    methods_text = " ".join(
        content for heading, content in sections.items()
        if any(term in heading for term in ("method", "approach", "experiment", "model", "proposed"))
    )
    if not methods_text:
        methods_text = normalized
    methods_text = methods_text[:9000]

    model_candidates = find_model_names(methods_text)
    datasets = find_datasets(normalized)
    metrics = find_metrics(normalized)
    approach = summarize_text(methods_text, 3)
    experimental = summarize_text(
        " ".join(content for heading, content in sections.items() if "experiment" in heading or "evaluation" in heading)
        or methods_text,
        2,
    )
    return {
        "paper_title": "",
        "author": "",
        "year": "",
        "summary": summarize_text(summary_basis, 4),
        "methodology": {
            "approach": approach,
            "experimental_methods": experimental,
            "models": model_candidates[:8],
        },
        "datasets": datasets,
        "metrics": metrics,
        "verification_notes": [
            "Rule-based extraction is a best-effort reading aid; verify the methodology and claims in the source paper.",
        ],
    }


def split_sections(text: str) -> dict[str, str]:
    heading_pattern = re.compile(
        r"(?im)^\s*((?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|related work|background|"
        r"method(?:ology)?|proposed approach|our approach|experiments?|experimental setup|"
        r"evaluation|results|discussion|conclusion|limitations)(?:\s+and\s+\w+)?)\s*$"
    )
    matches = list(heading_pattern.finditer(text))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else min(len(text), start + 12000)
        heading = re.sub(r"^\d+(?:\.\d+)*\.?\s+", "", match.group(1).lower()).strip()
        sections[heading] = text[start:end].strip()
    return sections


def find_abstract(text: str) -> str:
    sections = split_sections(text)
    if sections.get("abstract"):
        return sections["abstract"][:6000]
    match = re.search(r"(?is)\babstract\b\s*[:.]?\s*(.{100,5000}?)(?=\n\s*(?:1\.?\s+)?introduction\b)", text)
    return match.group(1).strip() if match else ""


def first_meaningful_paragraph(text: str) -> str:
    paragraphs = [re.sub(r"\s+", " ", part).strip() for part in re.split(r"\n\s*\n", text)]
    for paragraph in paragraphs:
        if len(paragraph) > 160 and not re.match(r"(?i)(abstract|contents|copyright|arxiv)", paragraph):
            return paragraph[:4000]
    return text[:2000]


def summarize_text(text: str, max_sentences: int) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    cleaned = re.sub(r"(?<=\w)-\s+(?=[a-z])", "", cleaned)
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", cleaned)
    selected = [sentence.strip() for sentence in sentences if len(sentence.strip()) > 35]
    if not selected:
        return cleaned[:650].strip()
    # Prefer substantive sentences but retain the paper's original wording.
    ranked = sorted(enumerate(selected), key=lambda item: (sentence_score(item[1]), -item[0]), reverse=True)
    best = sorted(ranked[:max_sentences], key=lambda item: item[0])
    summary = " ".join(sentence for _, sentence in best)
    return summary[:1000].rsplit(" ", 1)[0] + ("…" if len(summary) > 1000 else "")


def sentence_score(sentence: str) -> int:
    keywords = ("we propose", "we present", "we introduce", "our method", "our approach",
                "this paper", "results show", "experiments show", "achieves", "outperform",
                "evaluate", "dataset", "benchmark", "contribution")
    lowered = sentence.lower()
    return sum(3 if keyword in lowered else 0 for keyword in keywords) + min(len(sentence) // 100, 4)


def find_model_names(text: str) -> list[str]:
    patterns = [
        r"\b(?:BERT|RoBERTa|DistilBERT|ALBERT|DeBERTa|T5|BART|GPT[- ]?\d*|LLaMA[- ]?\d*|"
        r"Transformer|ResNet[- ]?\d+|VGG[- ]?\d+|DenseNet[- ]?\d+|EfficientNet[- ]?\w*|"
        r"ViT|Vision Transformer|YOLOv?\d*|U[- ]?Net|UNet|Faster R-CNN|Mask R-CNN|"
        r"Random Forest|XGBoost|LightGBM|SVM|Support Vector Machine|CNN|RNN|LSTM|GRU)\b",
    ]
    found = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.I):
            value = match.group(0)
            normalized = value.upper() if value.upper() in {"BERT", "GPT", "CNN", "RNN", "LSTM", "GRU", "SVM", "UNET", "VIT"} else value
            if normalized.lower() not in {item.lower() for item in found}:
                found.append(normalized)
    return found


def find_datasets(text: str) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    for name in sorted(DATASET_NAMES, key=len, reverse=True):
        match = re.search(rf"(?i)(?<![\w-]){re.escape(name)}(?![\w-])", text)
        if not match or any(item["name"].lower() == name.lower() for item in found):
            continue
        context = re.sub(r"\s+", " ", text[max(0, match.start() - 90):min(len(text), match.end() + 120)]).strip()
        found.append({"name": name, "context": context[:190], "confidence": "high"})
    return found[:20]


def find_metrics(text: str) -> list[dict[str, str]]:
    metrics: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for name, pattern in METRIC_NAMES:
        for match in re.finditer(pattern, text, re.I):
            window_start = max(0, match.start() - 100)
            window_end = min(len(text), match.end() + 120)
            context = re.sub(r"\s+", " ", text[window_start:window_end]).strip()
            value_match = re.search(
                r"(?:[:=]\s*|\b(?:of|is|was|at|to|reached|achieved|score(?:d)?|with)\s+)"
                r"([+-]?\d+(?:,\d{3})*(?:\.\d+)?\s*%?)",
                text[match.end():min(len(text), match.end() + 80)],
                re.I,
            )
            if not value_match:
                value_match = re.search(
                    r"([+-]?\d+(?:\.\d+)?\s*%)",
                    text[max(0, match.start() - 55):match.start()],
                    re.I,
                )
            if not value_match:
                continue
            value = re.sub(r"\s+", "", value_match.group(1)).replace(",", "")
            key = (name.lower(), value)
            if key in seen:
                continue
            seen.add(key)
            metrics.append({"name": name, "value": value, "context": context[:190]})
            if len(metrics) >= 60:
                return metrics
    return metrics


def extract_with_gemini(text: str, api_key: str) -> dict[str, Any]:
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
    prompt = f"""Analyze this scientific paper text and return only valid JSON with this schema:
{{
  "paper_title": "string",
  "author": "string",
  "year": "string",
  "summary": "concise summary grounded in the paper",
  "methodology": {{"approach": "string", "experimental_methods": "string", "models": ["string"]}},
  "datasets": [{{"name": "string", "context": "short source context", "confidence": "high|medium|low"}}],
  "metrics": [{{"name": "metric", "value": "reported value with unit", "context": "short context"}}],
  "verification_notes": ["uncertainty or detail that should be manually checked"]
}}
Do not invent values. Include a metric only when both metric name and reported value appear in the text. Return empty strings/lists when not found. The text may be truncated.

PAPER TEXT:
{text[:MAX_TEXT_CHARS]}"""
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
    }).encode("utf-8")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='-')}:generateContent"
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise HTTPException(status_code=502, detail=f"Gemini API returned HTTP {exc.code}: {detail}") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach the Gemini API: {exc}") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned an unreadable response.") from exc
    try:
        response_text = payload["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(response_text)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Gemini did not return the expected structured analysis.") from exc
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Gemini returned an invalid analysis structure.")
    result["methodology"] = result.get("methodology") if isinstance(result.get("methodology"), dict) else {}
    result["datasets"] = normalize_datasets(result.get("datasets"))
    result["metrics"] = normalize_metrics(result.get("metrics"))
    return result


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()][:20]


def normalize_datasets(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    output = []
    for item in value[:30]:
        if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip():
            output.append({
                "name": item["name"].strip(),
                "context": str(item.get("context", "")).strip()[:300],
                "confidence": item.get("confidence") if item.get("confidence") in {"high", "medium", "low"} else "medium",
            })
    return output


def normalize_metrics(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    output = []
    for item in value[:60]:
        if isinstance(item, dict) and isinstance(item.get("name"), str) and isinstance(item.get("value"), (str, int, float)):
            output.append({
                "name": item["name"].strip()[:80],
                "value": str(item["value"]).strip()[:50],
                "context": str(item.get("context", "")).strip()[:300],
            })
    return output
