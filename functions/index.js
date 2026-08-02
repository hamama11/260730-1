const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// CORS middleware helper
const cors = require("cors")({ origin: true });

/**
 * Cloud Function to generate AI feedback hint using Google Gemini 1.5 Flash.
 * Saves the student submission and returns the AI hint feedback.
 */
exports.getAiHint = onRequest({ cors: true }, async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }

    cors(req, res, async () => {
        try {
            const { teacherId, roomId, studentId, studentName, answerA, answerB, answers, copyCount, pasteCount, drawingImg } = req.body;

            if (!roomId || !studentName || !teacherId) {
                res.status(400).json({
                    success: false,
                    error: "필수 입력값(교사 식별 정보, 수업 ID, 이름)이 누락되었습니다."
                });
                return;
            }

            // Verify room exists
            const roomRef = db.collection("users").doc(teacherId).collection("rooms").doc(roomId);
            const roomSnap = await roomRef.get();
            if (!roomSnap.exists) {
                res.status(404).json({
                    success: false,
                    error: "존재하지 않는 수업방입니다."
                });
                return;
            }

            // Initialize Gemini API
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                logger.error("GEMINI_API_KEY가 환경변수로 설정되지 않았습니다.");
                res.status(500).json({
                    success: false,
                    error: "서버 설정 오류: Gemini API Key가 유효하지 않습니다."
                });
                return;
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: "gemini-1.5-flash",
                systemInstruction: "너는 친절하고 다정한 수학/과학 보조교사야. 정답을 직접 알려주지 말고, 학생이 작성한 관찰 및 추론 내용을 바탕으로 스스로 원리를 깨달을 수 있는 1~2문장의 발문형 질문 힌트를 제공해줘."
            });

            // Make prompt dynamically based on the type of answers
            let prompt = "";
            let answersToSave = null;

            if (Array.isArray(answers) && answers.length > 0) {
                answersToSave = answers;
                prompt = `학생 학번: ${studentId || "기재 안 함"}\n학생 이름: ${studentName}\n\n[탐구 답변]\n`;
                answers.forEach((ans, idx) => {
                    prompt += `질문 ${idx + 1}. ${ans.question} (${ans.type === 'objective' ? '객관식' : '주관식'})\n답변: ${ans.answer}\n\n`;
                });
            } else {
                if (!answerA || !answerB) {
                    res.status(400).json({
                        success: false,
                        error: "답안 정보가 전달되지 않았습니다."
                    });
                    return;
                }
                prompt = `학생 학번: ${studentId || "기재 안 함"}\n학생 이름: ${studentName}\n\n[질문 A (관찰한 특징/특이점)]\n${answerA}\n\n[질문 B (추론한 수학/과학적 원리)]\n${answerB}`;
            }

            // Generate content
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const aiHint = response.text().trim();

            // Save submission to Firestore
            const submissionData = {
                studentId: studentId || "",
                studentName,
                aiHint,
                copyCount: copyCount || 0,
                pasteCount: pasteCount || 0,
                drawingImg: drawingImg || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };

            if (answersToSave) {
                submissionData.answers = answersToSave;
            } else {
                submissionData.answerA = answerA;
                submissionData.answerB = answerB;
            }

            const subDocRef = roomRef.collection("submissions").doc(studentId);
            await subDocRef.set(submissionData);
            logger.info(`학생 제출물이 기록되었습니다. Room: ${roomId}, Student: ${studentId}`);

            res.json({
                success: true,
                hint: aiHint
            });

        } catch (error) {
            logger.error("AI 힌트 생성 중 에러 발생:", error);
            res.status(500).json({
                success: false,
                error: "서버 처리 중 오류가 발생했습니다. 상세 정보: " + error.message
            });
        }
    });
});
