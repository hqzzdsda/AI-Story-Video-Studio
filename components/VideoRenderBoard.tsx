'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// 🌟 强效视图解析器：通吃中英文脏数据
const getMatchedView = (rawView: string | null | undefined): 'front' | 'side' | 'back' => {
  if (!rawView) return 'front';
  const v = String(rawView).toLowerCase();
  if (v.includes('side') || v.includes('侧')) return 'side';
  if (v.includes('back') || v.includes('背')) return 'back';
  return 'front';
};

// 🌟 视图中文标签显示
const translateView = (view: string | null | undefined) => {
  const v = getMatchedView(view);
  return v === 'side' ? '侧面 (Side)' : v === 'back' ? '背面 (Back)' : '正面 (Front)';
};

export default function VideoRenderBoard({ userId }: { userId: string }) {
  const [projectList, setProjectList] = useState<any[]>([]);
  const [characterList, setCharacterList] = useState<any[]>([]);
  const [displayUrls, setDisplayUrls] = useState<Record<string, string>>({});
  const [characterViewsMap, setCharacterViewsMap] = useState<{ front?: string, side?: string, back?: string }>({});
  
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedCharacter, setSelectedCharacter] = useState<any>(null);
  const [scenes, setScenes] = useState<any[]>([]);
  
  const [keyframes, setKeyframes] = useState<Record<number, string>>({});
  const [videos, setVideos] = useState<Record<number, string>>({});
  
  const [loadingState, setLoadingState] = useState<{ index: number, type: 'image' | 'video' | 'end_image' } | null>(null);
  const [previewMedia, setPreviewMedia] = useState<{ url: string, type: 'image' | 'video' } | null>(null);

  const [stitchedVideoPreview, setStitchedVideoPreview] = useState<{ privatePath: string, publicUrl: string } | null>(null);
  const [activeProjectStatus, setActiveProjectStatus] = useState<string>('draft');

  const resolveUrls = async (paths: (string | null | undefined)[]) => {
    const needsSign = paths.filter((p): p is string => typeof p === 'string' && !p.startsWith('http'));
    if (needsSign.length === 0) return;
    const { data } = await supabase.storage.from('user_assets').createSignedUrls(needsSign, 3600);
    if (data) {
      setDisplayUrls(prev => {
        const newMap = { ...prev };
        data.forEach(item => { if (item.signedUrl) newMap[item.path] = item.signedUrl; });
        return newMap;
      });
    }
  };

  const getImgSrc = (path: string | undefined) => {
    if (!path) return undefined;
    return path.startsWith('http') ? path : (displayUrls[path] || undefined);
  };

  useEffect(() => {
    const fetchAssets = async () => {
      const { data: projs } = await supabase.from('video_projects').select('id, title').eq('user_id', userId).not('title', 'is', null);
      if (projs) setProjectList(projs);
      const { data: chars } = await supabase.from('characters').select('*').eq('is_verified', true);
      if (chars) {
        setCharacterList(chars);
        resolveUrls(chars.map(c => c.anchor_image_url)); 
      }
    };
    fetchAssets();
  }, [userId]);

  useEffect(() => {
    if (!selectedCharacter) return;
    const fetchCharacterViews = async () => {
      const viewsMap: any = { front: selectedCharacter.anchor_image_url };
      const { data } = await supabase.from('character_views').select('view_tag, image_url').eq('character_id', selectedCharacter.id);
      if (data) {
        data.forEach(view => {
          const safeTag = getMatchedView(view.view_tag);
          if (safeTag === 'side') viewsMap.side = view.image_url;
          if (safeTag === 'back') viewsMap.back = view.image_url;
        });
      }
      setCharacterViewsMap(viewsMap);
    };
    fetchCharacterViews();
  }, [selectedCharacter]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const fetchScenes = async () => {
      const { data: proj } = await supabase.from('video_projects').select('status').eq('id', selectedProjectId).single();
      if (proj) setActiveProjectStatus(proj.status);

      const { data } = await supabase.from('storyboards').select('*').eq('project_id', selectedProjectId).order('scene_index', { ascending: true });
      if (data) {
        setScenes(data);
        const existingVideos: Record<number, string> = {};
        const pathsToResolve: string[] = [];
        data.forEach(s => {
          if (s.video_url) {
            existingVideos[s.scene_index] = s.video_url;
            pathsToResolve.push(s.video_url);
          }
        });
        setVideos(existingVideos); 
        if (pathsToResolve.length > 0) resolveUrls(pathsToResolve);
      }
    };
    fetchScenes();
  }, [selectedProjectId]);

  const handleGenerateKeyframe = async (scene: any, isEndFrame = false) => {
    if (!selectedCharacter) return alert("请先在上方选择一位主角！");
    if (!selectedProjectId) return alert("项目 ID 丢失，请刷新重试");

    const rawPrompt = isEndFrame ? scene.end_frame_prompt : scene.start_frame_prompt;
    
    // 🌟 强效解析目标视图
    const targetView = getMatchedView(isEndFrame ? scene.end_frame_view : scene.start_frame_view);

    if (!rawPrompt) return alert("该分镜缺少首尾帧视觉描述！");

    const pureEnglishPrompt = rawPrompt.split('||')[0].trim();
    const finalPrompt = pureEnglishPrompt;

    // 🌟 绝对精确地连接三视图锚点
    let targetAnchorImage = selectedCharacter.anchor_image_url; 
    if (targetView === 'side' && characterViewsMap.side) {
        targetAnchorImage = characterViewsMap.side;
    } else if (targetView === 'back' && characterViewsMap.back) {
        targetAnchorImage = characterViewsMap.back;
    }

    const targetIndex = isEndFrame ? scene.scene_index + 1 : scene.scene_index;
    setLoadingState({ index: targetIndex, type: isEndFrame ? 'end_image' : 'image' });

    try {
      const { data, error } = await supabase.functions.invoke('step5-keyframe', {
        body: { 
          projectId: selectedProjectId, 
          userId, 
          prompt: finalPrompt, 
          anchorImage: targetAnchorImage,
          targetView: targetView // 🌟 【核心修复】：把视角传给后端！有了它，后端才会加上 Strict side profile view！
        }
      });
      if (error || data?.error) throw error || new Error(data.error);
      
      setKeyframes(prev => ({ ...prev, [targetIndex]: data.imageUrl }));

      if (activeProjectStatus === 'draft') {
         await supabase.from('video_projects').update({ status: 'unstitched' }).eq('id', selectedProjectId);
         setActiveProjectStatus('unstitched');
      }

    } catch (err: any) { 
      alert("生成图片失败: " + err.message); 
    } finally { 
      setLoadingState(null); 
    }
  };

  const handleRenderVideo = async (scene: any) => {
    const sceneIndex = scene.scene_index;
    const startImg = keyframes[sceneIndex];
    const endImg = keyframes[sceneIndex + 1]; 

    if (!startImg || !endImg) return alert("必须首尾两张图都生成完毕，才能进行视频插值渲染！");
    if (!scene.start_frame_prompt) return alert("这是旧版剧本，不支持插值渲染，请重新生成剧本！");

    const pureEnglishPrompt = scene.start_frame_prompt.split('||')[0].trim();
    
    setLoadingState({ index: sceneIndex, type: 'video' });
    try {
      const { data, error } = await supabase.functions.invoke('step4-video', {
        body: { 
          projectId: selectedProjectId, 
          userId, 
          sceneIndex, 
          imageUrl: startImg, 
          lastFrameImageUrl: endImg, 
          visualPromptEn: pureEnglishPrompt, 
          dialogueZh: scene.dialogue_zh || "" 
        }
      });
      if (error || data?.error) throw error || new Error(data.error);
      
      const privateVideoPath = data.videoUrl; 
      
      await supabase.from('storyboards').update({ video_url: privateVideoPath }).eq('project_id', selectedProjectId).eq('scene_index', sceneIndex);
      if (activeProjectStatus === 'draft') {
         await supabase.from('video_projects').update({ status: 'unstitched' }).eq('id', selectedProjectId);
         setActiveProjectStatus('unstitched');
      }

      setVideos(prev => ({ ...prev, [sceneIndex]: privateVideoPath }));
      resolveUrls([privateVideoPath]); 
      
    } catch (err: any) { 
      alert("视频渲染失败: " + err.message); 
    } finally { 
      setLoadingState(null); 
    }
  };

  const handleStitchVideos = async () => {
    const sortedVideoPaths = scenes.map(s => videos[s.scene_index]);
    if (sortedVideoPaths.some(path => !path)) return alert("请确保所有分镜视频都已渲染完毕！");

    setLoadingState({ index: 999, type: 'video' }); 

    try {
      const { data: createData, error: createError } = await supabase.functions.invoke('step6-stitch', {
        body: { action: 'create', projectId: selectedProjectId, userId, videoPaths: sortedVideoPaths }
      });

      if (createError || createData?.error) throw createError || new Error(createData?.error);

      const predictionId = createData.predictionId;
      let isComplete = false;
      let attempts = 0;

      while (!isComplete && attempts < 60) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 3000)); 

        const { data: checkData, error: checkError } = await supabase.functions.invoke('step6-stitch', {
          body: { action: 'check', predictionId, projectId: selectedProjectId, userId }
        });

        if (checkError || checkData?.error) {
           console.warn("轮询卡顿...", checkError || checkData?.error);
           continue; 
        }

        if (checkData.status === 'succeeded') {
          isComplete = true;
          const { data: signedData } = await supabase.storage.from('user_assets').createSignedUrl(checkData.finalUrl, 3600);
          
          setStitchedVideoPreview({
            privatePath: checkData.finalUrl,
            publicUrl: signedData?.signedUrl || checkData.finalUrl
          });
          
        } else if (checkData.status === 'failed') {
          throw new Error("云端合并失败: " + (checkData.error || "大模型报错"));
        }
      }
      if (!isComplete) throw new Error("合并超时，请稍后前往资产库查看是否成功");

    } catch (err: any) {
      alert("缝合过程出错: " + err.message);
    } finally {
      setLoadingState(null);
    }
  };

  const handleRejectStitched = () => {
    if (confirm("确定要放弃这次合并的成片吗？(可重新合并)")) setStitchedVideoPreview(null);
  };

  const handleApproveStitched = async () => {
    if (!stitchedVideoPreview) return;
    const currentProj = projectList.find(p => p.id === selectedProjectId);
    const newTitle = prompt("🎉 杀青大吉！请为这部终极成片命名:", currentProj?.title || "未命名大片");
    
    if (!newTitle || newTitle.trim() === '') return;

    try {
      const { error } = await supabase.from('video_projects').update({ 
        title: newTitle,
        final_video_url: stitchedVideoPreview.privatePath 
      }).eq('id', selectedProjectId);

      if (error) throw error;
      setActiveProjectStatus('stitched');
      setStitchedVideoPreview(null);
      alert(`✅ 电影 [${newTitle}] 已入库！\n请前往【资产库 -> 终极成片】查看！`);
    } catch (err: any) {
      alert("保存数据库失败: " + err.message);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 bg-gray-900 rounded-2xl shadow-2xl text-white">
      <div className="border-b border-gray-800 pb-6">
        <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          4. 最终渲染总控台 (电影级闭环)
        </h2>
        <p className="text-sm text-gray-400 mt-2">使用首尾帧插值技术，将剧本与角色进行无缝一镜到底渲染。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-800 p-6 rounded-xl border border-gray-700">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-300">1. 选择导入的剧本</label>
          <select 
            className="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg outline-none focus:border-blue-500"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
          >
            <option value="">-- 请选择剧本 --</option>
            {projectList.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-300">2. 选择参演的主角</label>
          <div className="flex gap-4">
             <select 
              className="flex-1 p-3 bg-gray-900 border border-gray-700 rounded-lg outline-none focus:border-purple-500"
              value={selectedCharacter?.id || ''}
              onChange={(e) => {
                const char = characterList.find(c => c.id === e.target.value);
                setSelectedCharacter(char || null);
              }}
            >
              <option value="">-- 请选择角色 --</option>
              {characterList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {selectedCharacter && (
              <img src={getImgSrc(selectedCharacter.anchor_image_url)} className="w-12 h-12 rounded-lg object-cover border border-purple-500 shadow-md" />
            )}
          </div>
        </div>
      </div>

      {scenes.length > 0 && selectedCharacter ? (
        <div className="space-y-10 pt-4 relative">
          <div className="absolute left-8 top-10 bottom-10 w-1 bg-gray-800 rounded-full z-0 hidden lg:block"></div>

          {scenes.map((scene, index) => {
             const isLastScene = index === scenes.length - 1; 
             const startImg = keyframes[scene.scene_index];
             const endImg = keyframes[scene.scene_index + 1];
             const canRenderVideo = startImg && endImg; 

             const isGeneratingStart = loadingState?.index === scene.scene_index && loadingState?.type === 'image';
             const isGeneratingEnd = loadingState?.index === scene.scene_index + 1 && loadingState?.type === 'end_image';
             const isGeneratingVid = loadingState?.index === scene.scene_index && loadingState?.type === 'video';
             
             const videoSrc = getImgSrc(videos[scene.scene_index]);
             
             return (
             <div key={scene.scene_index} className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 bg-gray-800/80 p-6 rounded-2xl border border-gray-700 shadow-xl backdrop-blur-sm">
                
                <div className="col-span-1 lg:col-span-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 bg-gray-700 text-blue-300 text-sm font-black rounded-lg shadow-inner">🎬 幕 {scene.scene_index}</span>
                  </div>
                  <p className="text-gray-300 text-sm leading-relaxed">{scene.raw_script}</p>
                </div>
                
                <div className="col-span-1 lg:col-span-4 flex flex-col space-y-4 border-l border-gray-700 pl-6">
                  
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-blue-400 font-bold tracking-widest">▶ START FRAME</span>
                      <span className="px-2 py-0.5 rounded bg-gray-700 text-[10px] text-gray-300 font-bold border border-gray-600">
                        锚点匹配: {translateView(scene.start_frame_view)}
                      </span>
                    </div>
                    <div className="group relative w-full aspect-video bg-black rounded-xl border-2 border-dashed border-gray-600 overflow-hidden flex items-center justify-center transition-all">
                      {startImg ? (
                        <>
                          <img src={startImg} className="w-full h-full object-cover" />
                          <div onClick={() => setPreviewMedia({ url: startImg, type: 'image' })} className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer backdrop-blur-sm">
                            <span className="text-white font-bold bg-black/60 px-4 py-2 rounded-lg text-sm">🔍 放大预览</span>
                          </div>
                        </>
                      ) : <span className="text-gray-600 text-xs">等待渲染此幕首帧</span>}
                    </div>
                    <button 
                      onClick={() => handleGenerateKeyframe(scene, false)} 
                      disabled={isGeneratingStart || isGeneratingVid} 
                      className={`w-full py-2.5 mt-2 font-bold rounded-xl transition-all outline-none text-sm ${isGeneratingStart ? 'bg-blue-600/50 text-blue-100 animate-pulse' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}
                    >
                      {isGeneratingStart ? '⏳ 绘制中...' : startImg ? '🔄 重新抽卡' : '🎨 渲染本幕首帧'}
                    </button>
                  </div>

                  {isLastScene && (
                    <div className="pt-4 border-t border-gray-700/50 mt-2">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-red-400 font-bold tracking-widest">⏹ FINAL FRAME</span>
                        <span className="px-2 py-0.5 rounded bg-gray-700 text-[10px] text-gray-300 font-bold border border-gray-600">
                          锚点匹配: {translateView(scene.end_frame_view)}
                        </span>
                      </div>
                      <div className="group relative w-full aspect-video bg-black rounded-xl border-2 border-dashed border-gray-600 overflow-hidden flex items-center justify-center transition-all">
                        {endImg ? (
                          <>
                            <img src={endImg} className="w-full h-full object-cover" />
                            <div onClick={() => setPreviewMedia({ url: endImg, type: 'image' })} className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer backdrop-blur-sm">
                              <span className="text-white font-bold bg-black/60 px-4 py-2 rounded-lg text-sm">🔍 放大预览</span>
                            </div>
                          </>
                        ) : <span className="text-gray-600 text-xs">等待渲染大结局画面</span>}
                      </div>
                      <button 
                        onClick={() => handleGenerateKeyframe(scene, true)} 
                        disabled={isGeneratingEnd || isGeneratingVid} 
                        className={`w-full py-2.5 mt-2 font-bold rounded-xl transition-all outline-none text-sm ${isGeneratingEnd ? 'bg-red-600/50 text-red-100 animate-pulse' : 'bg-red-900/40 hover:bg-red-800/60 text-red-200'}`}
                      >
                        {isGeneratingEnd ? '⏳ 绘制结局中...' : endImg ? '🔄 重新抽卡' : '🎬 渲染大结局画面'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="col-span-1 lg:col-span-4 flex flex-col space-y-3 border-l border-gray-700 pl-6">
                  <div className="group relative w-full aspect-video bg-black rounded-xl border-2 border-gray-700 overflow-hidden shadow-inner flex items-center justify-center">
                    {videoSrc ? (
                      <>
                        <video src={videoSrc} controls className="w-full h-full object-cover" />
                        <div onClick={() => setPreviewMedia({ url: videoSrc, type: 'video' })} className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer pointer-events-auto" style={{ zIndex: 10 }}>
                          <span className="text-white font-bold bg-black/60 px-4 py-2 rounded-lg text-sm pointer-events-none">📺 全屏沉浸预览</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-center px-4">
                        <span className="text-gray-500 text-xs leading-relaxed">
                           {!startImg ? "⚠️ 请先在左侧生成本幕首帧" : !endImg ? (isLastScene ? "⚠️ 请生成下方的大结局尾帧" : "⚠️ 请先生成下一幕的首帧\n(将作为本幕尾帧使用)") : "✅ 首尾帧已就绪\n可进行一镜到底渲染"}
                        </span>
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={() => handleRenderVideo(scene)} 
                    disabled={!canRenderVideo || isGeneratingVid}
                    className={`w-full py-3 mt-auto font-black rounded-xl transition-all outline-none ${
                      !canRenderVideo 
                        ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700' 
                        : isGeneratingVid 
                          ? 'bg-purple-600/50 text-purple-100 cursor-wait animate-pulse ring-4 ring-purple-500/50' 
                          : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.5)] transform hover:-translate-y-0.5'
                    }`}
                  >
                    {!canRenderVideo ? '🔒 锁定 (需备齐首尾帧)' : isGeneratingVid ? '⏳ 引擎轰鸣，插值渲染中...' : '✨ 一镜到底：生成动态视频'}
                  </button>
                </div>
             </div>
             );
          })}
          
          <div className="sticky bottom-4 z-20 mt-10 bg-gray-900/90 backdrop-blur-xl p-4 border border-gray-700 rounded-2xl flex shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            <button 
              onClick={handleStitchVideos} 
              disabled={loadingState?.index === 999 || scenes.some(s => !videos[s.scene_index])}
              className={`w-full py-4 rounded-xl font-black text-xl shadow-lg transition-all flex items-center justify-center gap-3 ${
                scenes.some(s => !videos[s.scene_index])
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                  : loadingState?.index === 999
                    ? 'bg-gradient-to-r from-green-600 to-emerald-600 animate-pulse text-white'
                    : 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] transform hover:-translate-y-1'
              }`}
            >
              {loadingState?.index === 999 
                ? '⏳ 引擎全开！FFmpeg 云端硬核缝合中 (约需10-30秒)...' 
                : scenes.some(s => !videos[s.scene_index])
                  ? '🔒 锁定 (必须完成所有分镜的视频渲染，才能解锁终极合并)'
                  : '🎞️ 完美杀青！一键合并为最终成片'}
            </button>
          </div>
        </div>
      ) : (
        <div className="py-24 text-center text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl">
           请先在上方选择【剧本】和【参演角色】<br/><span className="text-xs mt-2 block opacity-70">解锁好莱坞级 AI 影视渲染流水线</span>
        </div>
      )}

      {/* 🌟 1. 全屏弹窗组件 */}
      {previewMedia && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 lg:p-10 animate-in fade-in duration-200">
          <button 
            onClick={() => setPreviewMedia(null)}
            className="absolute top-6 right-6 z-[110] text-white bg-white/10 hover:bg-white/20 rounded-full w-12 h-12 flex items-center justify-center text-2xl transition-all hover:rotate-90"
          >✕</button>
          <div className="relative w-full h-full max-w-7xl flex items-center justify-center">
            {previewMedia.type === 'image' ? (
              <img src={previewMedia.url} className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] ring-1 ring-white/10" />
            ) : (
              <video src={previewMedia.url} controls autoPlay className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] ring-1 ring-white/10 bg-black" />
            )}
          </div>
        </div>
      )}

      {/* 🌟 2. 终极成片专属【首映礼】 */}
      {stitchedVideoPreview && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 lg:p-10 animate-in fade-in">
          <h2 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-500 mb-2 drop-shadow-lg">
            🎉 缝合成功！首映预览
          </h2>
          <p className="text-gray-400 mb-8 font-medium tracking-wide">请确认画面，如满意将为其命名并存入私有资产库。</p>
          
          <div className="relative w-full max-w-5xl aspect-video bg-black rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(16,185,129,0.2)] ring-2 ring-emerald-500/50 mb-10">
            <video src={stitchedVideoPreview.publicUrl} controls autoPlay className="w-full h-full object-contain" />
          </div>

          <div className="flex gap-6 w-full max-w-3xl">
            <button 
              onClick={handleRejectStitched} 
              className="flex-1 py-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-bold text-lg transition-all"
            >
              ❌ 不满意，放弃此成片
            </button>
            <button 
              onClick={handleApproveStitched} 
              className="flex-[2] py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-xl font-black text-lg shadow-lg shadow-green-900/50 transition-all transform hover:-translate-y-1"
            >
              ✅ 非常满意！为其命名并存入终极资产库
            </button>
          </div>
        </div>
      )}

    </div>
  );
}