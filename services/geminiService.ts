
import React from 'react';
import { 
  GoogleGenAI, 
  Type, 
  FunctionDeclaration, 
  LiveServerMessage, 
  Modality, 
  LiveSession,
} from "@google/genai";
import { ConversationMessage } from "../types";

const getApiKey = (): string => {
  return process.env.API_KEY || "";
};

export const validateApiKey = async (key: string): Promise<{ valid: boolean; message?: string }> => {
    try {
        const ai = new GoogleGenAI({ apiKey: key });
        await ai.models.generateContent({ 
            model: 'gemini-3-flash-preview', 
            contents: 'Hello' 
        });
        return { valid: true };
    } catch (e: any) {
        console.error("API Key Validation Error:", e);
        return { valid: false, message: e.message || 'Chave inválida' };
    }
};

async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 2, delay: number = 1000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const isQuotaError = 
            error?.status === 429 || 
            error?.code === 429 || 
            error?.error?.code === 429 || 
            error?.error?.status === 'RESOURCE_EXHAUSTED' ||
            (error?.message && (
                error.message.includes('429') || 
                error.message.includes('exhausted') || 
                error.message.includes('quota') ||
                error.message.includes('RESOURCE_EXHAUSTED')
            )) ||
            (JSON.stringify(error).includes('RESOURCE_EXHAUSTED'));

        if (maxRetries > 0 && isQuotaError) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryOperation(operation, maxRetries - 1, delay * 2);
        }
        throw error;
    }
}

export interface LiveSessionController {
  sessionPromise: Promise<LiveSession>;
  startMicrophone: () => Promise<void>;
  stopMicrophoneInput: () => void;
  stopPlayback: () => void;
  closeSession: () => void;
}

const switchActiveAgentFunctionDeclaration: FunctionDeclaration = {
  name: 'switchActiveAgent',
  parameters: {
    type: Type.OBJECT,
    description: 'Transfere o usuário para outro especialista.',
    properties: {
        agentName: {
            type: Type.STRING,
            description: "Nome do especialista (ex: 'programador', 'trafego', 'padrao')."
        }
    },
    required: ['agentName']
  },
};

const getCurrentDateTimeBrazilFunctionDeclaration: FunctionDeclaration = {
  name: 'getCurrentDateTimeBrazil',
  parameters: {
    type: Type.OBJECT,
    description: 'Retorna data e hora atuais no Brasil.',
    properties: {},
  },
};

const activateCameraFunctionDeclaration: FunctionDeclaration = {
    name: 'activateCamera',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Ativa a câmera.'
};

const deactivateCameraFunctionDeclaration: FunctionDeclaration = {
    name: 'deactivateCamera',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Desativa a câmera.'
};

const activateScreenSharingFunctionDeclaration: FunctionDeclaration = {
    name: 'activateScreenSharing',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Inicia compartilhamento de tela.'
};

const deactivateScreenSharingFunctionDeclaration: FunctionDeclaration = {
    name: 'deactivateScreenSharing',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Encerra compartilhamento de tela.'
};

function executeGetCurrentDateTimeBrazil(): string {
  const now = new Date();
  return now.toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo', 
    dateStyle: 'full', 
    timeStyle: 'long' 
  });
}

export const visionSystemModuleInstruction = `
**DIRETRIZ VISUAL RESTRITA**
1. **Verdade Visual**: Analise apenas o que está explicitamente na imagem. Nunca invente elementos ou informações que não estão na tela.
2. **Status de Visão**: Você só tem permissão para dizer "estou vendo sua tela" se o compartilhamento de tela estiver ATIVO. Caso contrário, peça para o usuário ativar.
3. **Foco Instantâneo**: Identifique o conteúdo imediatamente e responda de forma ultra-concisa.
4. **Pesquisa Visual**: Se o usuário mostrar um programa, erro ou site que você não conhece totalmente, use a ferramenta de busca (Google Search) imediatamente para entender o contexto real e atual.
`.trim();

export const baseSystemInstruction = `
    IDENTIDADE: GIDEÃO - CONSULTOR COM BUSCA EM TEMPO REAL
    Sua prioridade absoluta é velocidade, fluidez e precisão baseada em dados atuais.

    **REGRAS CRÍTICAS DE COMPORTAMENTO:**
    1. **Inteligência em Tempo Real**: Use a ferramenta Google Search para QUALQUER informação que não seja de conhecimento geral estável (notícias, preços, versões de software, clima). Se você vir algo na tela que parece desatualizado ou desconhecido, pesquise proativamente.
    2. **Conciso e Direto**: Respostas de voz extremamente curtas (4-8 segundos). Sem "enchimento".
    3. **Aderência ao Contexto**: Responda estritamente ao que foi perguntado.
    4. **Memória Contínua**: Mantenha o contexto da conversa anterior mesmo após reativar o microfone.
    5. **Honestidade de Visão**: Só diga que está vendo algo se o STATUS VISUAL for ATIVO.
    
    ${visionSystemModuleInstruction}
`.trim();

const andromedaTrafficManagerInstruction = `
    ${visionSystemModuleInstruction}
    **IDENTIDADE: ANDROMEDA ADS (ESTRATEGISTA DIRETO)**
    Foco em Meta Ads. Use a busca para verificar tendências de criativos atuais se necessário. Respostas GPS.
`.trim();

const googleAdsAgentInstruction = `
    ${visionSystemModuleInstruction}
    **IDENTIDADE: GOOGLE ADS (CONSULTOR ANALÍTICO)**
    Foco em ROI. Use a busca para verificar volumes de palavras-chave atuais se solicitado.
`.trim();

function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

export const summarizeText = async (text: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Resuma em 3 palavras: ${text.substring(0, 300)}`,
        });
        return response.text?.trim() || "Nova Conversa";
    } catch (error) {
        return "Nova Conversa";
    }
};

export const generateImage = async (prompt: string, style: string, aspectRatio: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    let arValue = "1:1";
    if (aspectRatio.includes("16:9")) arValue = "16:9";
    else if (aspectRatio.includes("9:16")) arValue = "9:16";

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: `${prompt}. Estilo: ${style}` }] },
            config: { imageConfig: { aspectRatio: arValue as any } }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData?.data) return part.inlineData.data;
        }
        throw new Error("Erro");
    } catch (error) {
        throw error;
    }
};

export const sendTextMessage = async (
    message: string,
    history: ConversationMessage[],
    agent: string,
    file: { base64: string; mimeType: string } | undefined,
    isVisualActive: boolean,
    programmingLevel?: string,
    customInstruction?: string,
    isSummarized: boolean = false
) => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    let systemInstruction = (agent === 'traffic_manager') ? andromedaTrafficManagerInstruction : 
                             (agent === 'google_ads') ? googleAdsAgentInstruction : 
                             (customInstruction || baseSystemInstruction);

    if (isSummarized) systemInstruction += "\nRESPOSTA ULTRA-CURTA (MÁXIMO 1 LINHA).";
    systemInstruction += `\nSTATUS VISUAL: ${isVisualActive ? 'ATIVO. Analise o que vê.' : 'DESATIVADO.'}`;

    const contents: any[] = history.slice(-10).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: msg.imageUrl ? [{ text: msg.text }, { inlineData: { data: msg.imageUrl.split(',')[1], mimeType: 'image/jpeg' } }] : [{ text: msg.text }]
    }));

    const currentParts: any[] = [{ text: message }];
    if (file) currentParts.push({ inlineData: { data: file.base64, mimeType: file.mimeType } });
    
    return await retryOperation(async () => {
        return await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [...contents, { role: 'user', parts: currentParts }],
            config: { systemInstruction, tools: [{ googleSearch: {} }] }
        });
    });
};

export const createLiveSession = (
    callbacks: {
        onOpen: () => void;
        onClose: () => void;
        onError: (e: Error | ErrorEvent) => void;
        onInputTranscriptionUpdate: (text: string) => void;
        onOutputTranscriptionUpdate: (text: string) => void;
        onModelStartSpeaking: () => void;
        onModelStopSpeaking: (text: string) => void;
        onUserStopSpeaking: (text: string) => void;
        onTurnComplete: () => void;
        onInterrupt: () => void;
        onDeactivateScreenSharingCommand: () => void;
        onActivateScreenSharingCommand: () => void;
        onActivateCameraCommand: () => void;
        onDeactivateCameraCommand: () => void;
        onSwitchAgentCommand: (agentName: string) => void;
        onSessionReady: (session: LiveSession) => void;
    },
    inputCtx: AudioContext,
    outputCtx: AudioContext,
    nextStartTimeRef: React.MutableRefObject<number>,
    micStreamRef: React.MutableRefObject<MediaStream | null>,
    audioAnalyser: AnalyserNode | null,
    history: ConversationMessage[],
    agent: string,
    isVisualActive: boolean,
    programmingLevel?: string,
    customInstruction?: string,
    voiceName: string = 'Kore',
    isSummarized: boolean = false
): LiveSessionController => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    let systemInstruction = (agent === 'traffic_manager') ? andromedaTrafficManagerInstruction : 
                             (agent === 'google_ads') ? googleAdsAgentInstruction : 
                             (customInstruction || baseSystemInstruction);

    if (isSummarized) systemInstruction += "\nRESPOSTAS CURTAS.";
    systemInstruction += `\nSTATUS VISUAL: ${isVisualActive ? 'ATIVO. Use visão e busca se necessário.' : 'DESATIVADO.'}`;

    const recentHistory = history.slice(-10);
    if (recentHistory.length > 0) {
        systemInstruction += `\n\nCONTEXTO RECENTE:\n${recentHistory.map(m => `${m.role}: ${m.text.substring(0, 150)}`).join('\n')}`;
    }

    let currentInputTranscription = '';
    let currentOutputTranscription = '';
    let sources = new Set<AudioBufferSourceNode>();

    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            systemInstruction,
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Corrected tool ordering: Google Search is now always available
            tools: [
                { googleSearch: {} },
                { functionDeclarations: [switchActiveAgentFunctionDeclaration, getCurrentDateTimeBrazilFunctionDeclaration, activateCameraFunctionDeclaration, deactivateCameraFunctionDeclaration, activateScreenSharingFunctionDeclaration, deactivateScreenSharingFunctionDeclaration] }
            ]
        },
        callbacks: {
            onopen: () => callbacks.onOpen(),
            onmessage: async (message: LiveServerMessage) => {
                if (message.serverContent?.outputTranscription) {
                    currentOutputTranscription += message.serverContent.outputTranscription.text;
                    callbacks.onOutputTranscriptionUpdate(currentOutputTranscription);
                } else if (message.serverContent?.inputTranscription) {
                    currentInputTranscription += message.serverContent.inputTranscription.text;
                    callbacks.onInputTranscriptionUpdate(currentInputTranscription);
                }

                if (message.serverContent?.turnComplete) {
                    callbacks.onTurnComplete();
                    if (currentInputTranscription) {
                        callbacks.onUserStopSpeaking(currentInputTranscription);
                        currentInputTranscription = '';
                    }
                    if (currentOutputTranscription) {
                        const text = currentOutputTranscription.trim();
                        currentOutputTranscription = '';
                        callbacks.onModelStopSpeaking(text);
                    }
                }

                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    if (!currentOutputTranscription) callbacks.onModelStartSpeaking();
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                    const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), outputCtx, 24000, 1);
                    const source = outputCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioAnalyser || outputCtx.destination);
                    source.onended = () => sources.delete(source);
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sources.add(source);
                }

                if (message.serverContent?.interrupted) {
                    callbacks.onInterrupt();
                    sources.forEach(s => { try { s.stop(); } catch(e){} });
                    sources.clear();
                    nextStartTimeRef.current = 0;
                }

                if (message.toolCall) {
                    for (const fc of message.toolCall.functionCalls) {
                        let res: any = { result: "ok" };
                        switch (fc.name) {
                            case 'switchActiveAgent': callbacks.onSwitchAgentCommand((fc.args as any).agentName); break;
                            case 'activateCamera': callbacks.onActivateCameraCommand(); break;
                            case 'deactivateCamera': callbacks.onDeactivateCameraCommand(); break;
                            case 'activateScreenSharing': callbacks.onActivateScreenSharingCommand(); break;
                            case 'deactivateScreenSharing': callbacks.onDeactivateScreenSharingCommand(); break;
                            case 'getCurrentDateTimeBrazil': res = { result: executeGetCurrentDateTimeBrazil() }; break;
                        }
                        sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: res } }));
                    }
                }
            },
            onclose: () => callbacks.onClose(),
            onerror: (e) => callbacks.onError(e)
        }
    });

    sessionPromise.then(session => callbacks.onSessionReady(session));

    const startMicrophone = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
        micStreamRef.current = stream;
        const micSource = inputCtx.createMediaStreamSource(stream);
        const scriptProcessor = inputCtx.createScriptProcessor(2048, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
            if (inputCtx.state === 'closed' || sources.size > 0) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            sessionPromise.then(s => s.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: arrayBufferToBase64(pcmData.buffer) } }));
        };
        micSource.connect(scriptProcessor);
        scriptProcessor.connect(inputCtx.destination);
    };

    return { 
        sessionPromise, 
        startMicrophone, 
        stopMicrophoneInput: () => micStreamRef.current?.getTracks().forEach(t => t.stop()), 
        stopPlayback: () => sources.forEach(s => { try { s.stop(); } catch(e){} }), 
        closeSession: () => sessionPromise.then(s => s.close()) 
    };
};
