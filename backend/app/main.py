from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import os
import httpx
import json
from dotenv import load_dotenv

# Load .env from project root (two levels up)
ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / '.env')

# Swapped OpenRouter for Groq
GROQ_API_KEY = os.getenv('GROQ_API_KEY')
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

app = FastAPI(title="Try Your Prime - Backend")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ConversationPayload(BaseModel):
    messages: list[ChatMessage]
    
PRIME_ENGINE_SYSTEM = """You are the Prime Engine, a cold, hyper-analytical, and brutally honest life-assessment AI. You are NOT a friendly chatbot. You do not show empathy, and you do not engage in small talk. Your sole purpose is to ruthlessly dissect the user's psychology, habits, and trajectory to predict their future.

IMPORTANT:
Return ONLY valid JSON.
No markdown. No explanations. No extra text.

Required JSON format:
{
  "chatResponse": "",
  "liveGoal": "Short summary of their stated goal (or 'Unknown' if avoiding)",
  "goalProgress": 0,
  "distanceMetric": "e.g., 'Miles away', 'Stagnant', 'Slipping backward'",
  "liveRisk": "One word risk factor (e.g., 'Complacency', 'Self-Sabotage')",
  "liveRiskDetail": "Short sentence explaining the risk",
  "liveFuture": "One or two words predicting their future (e.g., 'Mediocrity', 'Burnout')",
  "liveFutureDetail": "Brutal explanation of where their current habits lead"
}

BEHAVIORAL RULES:
1. ZERO TOLERANCE FOR EVASION: If the user gives low-effort, joking, or off-topic answers (e.g., "I'm hungry", "idk", "I'm a noob"), DO NOT play along. Call out their lack of focus, update their 'liveFuture' to something bleak like 'Failure' or 'Mediocrity', and aggressively redirect them to the assessment.
2. CHAT RESPONSE STRUCTURE: Your `chatResponse` must consist of two things ONLY: A sharp, piercing psychological observation about their previous answer, followed by exactly ONE hard-hitting question.
3. TONE: Clinical, uncompromising, intense, and psychologically sharp. You are holding up a mirror to their flaws.
4. NO THERAPY: Do not offer solutions or "healthier coping mechanisms" unless explicitly asked. You are here to assess, not to heal. 
"""

def build_conversation_prompt(messages: list[ChatMessage]) -> list[dict]:
    """Convert chat history to Groq message format."""
    system_message = {
        "role": "system",
        "content": PRIME_ENGINE_SYSTEM
    }
    
    # Convert ChatMessage objects to dicts
    message_dicts = [{"role": msg.role, "content": msg.content} for msg in messages]
    
    return [system_message] + message_dicts


@app.post('/api/chat')
async def chat(payload: ConversationPayload):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail='Server missing GROQ_API_KEY in .env')

    messages = build_conversation_prompt(payload.messages)

    headers = {
        'Authorization': f'Bearer {GROQ_API_KEY}',
        'Content-Type': 'application/json'
    }

    body = {
        "model": "llama-3.3-70b-versatile",  # Using Groq's high-performance Llama 3 model
        "messages": messages,
        "temperature": 0.3,  # Even lower for faster, predictable responses
        "max_tokens": 400, # Very lean to speed up responses
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(GROQ_API_URL, headers=headers, json=body)
    except httpx.RequestError as e:
        print(f"Groq request error: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Failed to reach Groq: {str(e)}")

    if resp.status_code >= 400:
        error_text = resp.text
        print(f"Groq error {resp.status_code}: {error_text}")
        raise HTTPException(status_code=resp.status_code, detail=f"Groq error: {error_text}")

    # Parse Groq response format
    try:
        data = resp.json()
        if "choices" in data and len(data["choices"]) > 0:
            text = data["choices"][0]["message"]["content"]
        else:
            print(f"Unexpected response format: {data}")
            raise ValueError("Unexpected Groq response format")
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        error_msg = f"Failed to parse Groq response: {str(e)}"
        print(error_msg)
        raise HTTPException(status_code=502, detail=error_msg)

    # Parse the JSON response from AI
    try:
        result = json.loads(text)
        print("AI JSON OUTPUT:", json.dumps(result, indent=2))
        return JSONResponse(result)
    except json.JSONDecodeError as e:
        # Try to extract JSON from text (in case AI added extra text)
        print(f"JSON parse failed, attempting extraction from: {text[:100]}")
        
        # Look for JSON object in the response
        import re
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            try:
                json_text = json_match.group(0)
                result = json.loads(json_text)
                print("Successfully extracted JSON from response")
                return JSONResponse(result)
            except json.JSONDecodeError:
                pass
        
        # If all else fails, return error
        error_msg = f"AI response is not valid JSON: {text[:200]}"
        print(error_msg)
        return JSONResponse({"error": "Invalid JSON from AI", "raw": text[:500]}, status_code=500)


# Serve static frontend from workspace root
app.mount('/', StaticFiles(directory=str(ROOT), html=True), name='static')