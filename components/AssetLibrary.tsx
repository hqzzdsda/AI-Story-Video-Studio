'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// 🌟 智能翻译字典：抛弃模糊匹配，只接受绝对干净的枚举值
const translateView = (view: string) => {
  const map: Record<string, string> = { front: '正面', side: '侧面', back: '背面' };
  return map[view] || '正面'; // 绝对匹配
};

// 🌟 双语分割渲染器
const renderBilingualPrompt = (text: string) => {
  if (!text) return '';
  if (text.includes('||')) {
    const [en, zh] = text.split('||');
    return (
      <div className="flex flex-col gap-1 mt-1">
        <span className="text-gray-800 font-bold not-italic">{zh.trim()}</span>
        <span className="text-gray-400 text-[10px] font-mono leading-tight">{en.trim()}</span>
      </div>
    );
  }
  return <span className="text-gray-500 font-mono italic">{text}</span>;
};

export default function AssetLibrary({ userId }: { userId: string }) {
  const [tier, setTier] = useState<'basic' | 'pro'>('basic');
  
  const [projects, setProjects] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [displayUrls, setDisplayUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [viewingProject, setViewingProject] = useState<any>(null);
  const [projectScenes, setProjectScenes] = useState<any[]>([]);

  const [viewingCharacter, setViewingCharacter] = useState<any>(null);
  const [characterViews, setCharacterViews] = useState<{tag: string, url: string}[]>([]);

  const [previewMedia, setPreviewMedia] = useState<{ url: string, type: 'image' | 'video' } | null>(null);

  const limits = tier === 'pro' 
    ? { script: 10, character: 10, unstitched: 2, stitched: 5 }
    : { script: 3, character: 3, unstitched: 1, stitched: 2 };

  // 🌟 核心升级：剧本仓库永远显示所有项目底稿，其余分区按状态过滤
  const allScripts = projects; 
  const unstitchedProjects = projects.filter(p => p.computed_status === 'unstitched');
  const stitchedProjects = projects.filter(p => p.computed_status === 'stitched');

  useEffect(() => {
    fetchAssets();
  }, [userId]);

  const resolveUrls = async (paths: (string | null | undefined)[]) => {
    const needsSign = paths.filter((p): p is string => typeof p === 'string' && !p.startsWith('http'));
    if (needsSign.length === 0) return;
    const { data } = await supabase.storage.from('user_assets').createSignedUrls(needsSign, 3600);
    if (data) {
      setDisplayUrls(prev => {
        const newMap = { ...prev };
        data.forEach(item => { if (item.signedUrl && item.path) newMap[item.path] = item.signedUrl; });
        return newMap;
      });
    }
  };

  const getUrl = (path: string | undefined | null) => {
    if (!path) return '';
    return path.startsWith('http') ? path : (displayUrls[path] || '');
  };

  const fetchAssets = async () => {
    setLoading(true);
    const { data: profile } = await supabase.from('user_profiles').select('tier').eq('id', userId).single();
    if (profile) setTier(profile.tier);

    const { data: projs } = await supabase.from('video_projects').select('*').eq('user_id', userId).not('title', 'is', null).order('created_at', { ascending: false });
    
    if (projs && projs.length > 0) {
      const projIds = projs.map(p => p.id);
      
      const { data: scenes } = await supabase.from('storyboards')
        .select('project_id, video_url')
        .in('project_id', projIds)
        .not('video_url', 'is', null)
        .neq('video_url', ''); 

      const projectsWithFragments = new Set(scenes?.map(s => s.project_id) || []);

      const processedProjects = projs.map(p => {
         if (p.final_video_url && p.final_video_url.trim() !== '') return { ...p, computed_status: 'stitched' };
         if (projectsWithFragments.has(p.id) || p.status === 'unstitched') return { ...p, computed_status: 'unstitched' };
         return { ...p, computed_status: 'draft' };
      });

      setProjects(processedProjects);
      await resolveUrls(processedProjects.map(p => p.final_video_url));
    } else {
      setProjects([]);
    }

    const { data: chars } = await supabase.from('characters').select('*').eq('user_id', userId).eq('is_verified', true).order('created_at', { ascending: false });
    if (chars) {
      setCharacters(chars);
      await resolveUrls(chars.map(c => c.anchor_image_url));
    }
    setLoading(false);
  };

  const handleDelete = async (e: React.MouseEvent, type: 'character' | 'project', id: string) => {
    e.stopPropagation(); 
    if (!confirm("确定要永久销毁此资产吗？关联的音视频文件将不可恢复！")) return;
    
    try {
      const pathsToDelete: string[] = [];

      if (type === 'character') {
        await supabase.from('video_projects').update({ character_id: null }).eq('character_id', id);
        const { data: char } = await supabase.from('characters').select('anchor_image_url').eq('id', id).single();
        const { data: views } = await supabase.from('character_views').select('image_url').eq('character_id', id);
        if (char?.anchor_image_url) pathsToDelete.push(char.anchor_image_url);
        if (views) views.forEach(v => { if (v.image_url) pathsToDelete.push(v.image_url); });
        
        await supabase.from('character_views').delete().eq('character_id', id);
        await supabase.from('characters').delete().eq('id', id);
      } else {
        const { data: proj } = await supabase.from('video_projects').select('final_video_url').eq('id', id).single();
        if (proj?.final_video_url) pathsToDelete.push(proj.final_video_url);

        const { data: scenes } = await supabase.from('storyboards').select('video_url').eq('project_id', id);
        if (scenes) scenes.forEach(s => { if (s.video_url) pathsToDelete.push(s.video_url); });

        await supabase.from('storyboards').delete().eq('project_id', id);
        await supabase.from('video_projects').delete().eq('id', id);
      }
      
      if (pathsToDelete.length > 0) {
        await supabase.storage.from('user_assets').remove(pathsToDelete);
      }
      fetchAssets();
    } catch (err: any) { alert("删除失败: " + err.message); }
  };

  const handleRename = async (e: React.MouseEvent, table: string, id: string, currentName: string) => {
    e.stopPropagation();
    const newName = prompt("请输入新名称:", currentName);
    if (!newName || newName.trim() === '' || newName === currentName) return;
    const updateField = table === 'video_projects' ? { title: newName } : { name: newName };
    await supabase.from(table).update(updateField).eq('id', id);
    fetchAssets();
  };

  const handleDownload = async (e: React.MouseEvent, url: string, title: string) => {
    e.stopPropagation();
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('网络响应错误');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = `${title}.mp4`;
      document.body.appendChild(a);
      a.click();
      
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error('下载失败:', error);
      alert('下载失败，您可以尝试点击【播放成片】后在视频上右键“另存为”。');
    }
  };

  const openProjectDetails = async (project: any) => {
    setViewingProject(project);
    const { data } = await supabase.from('storyboards').select('*').eq('project_id', project.id).order('scene_index', { ascending: true });
    if (data) {
      setProjectScenes(data);
      await resolveUrls(data.map(s => s.video_url)); 
    }
  };

  const openCharacterDetails = async (char: any) => {
    setViewingCharacter(char);
    const { data } = await supabase.from('character_views').select('*').eq('character_id', char.id);
    const views = [{ tag: 'front', url: char.anchor_image_url }];
    if (data) {
      // 🌟 直接从数据库抓取干净的值进行渲染
      data.forEach(v => views.push({ tag: v.view_tag, url: v.image_url }));
    }
    await resolveUrls(views.map(v => v.url));
    setCharacterViews(views);
  };

  if (loading) return <div className="p-10 text-center text-gray-500 animate-pulse font-bold text-lg">正在加密读取并智能校验您的私有保险库...</div>;

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-gray-800">数据库总览</h2>
          <p className="text-gray-500 text-sm mt-1">SaaS 级资产生命周期管理 (Data-Driven 智能分类)</p>
        </div>
        <div className="text-right">
           <span className={`px-4 py-1.5 rounded-full text-xs font-black shadow-inner ${tier === 'pro' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-gray-100 text-gray-600'}`}>
             {tier.toUpperCase()} 模式
           </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* 1. 剧本草稿库：现在包含所有项目！ */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-80 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -z-10"></div>
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
            <h3 className="text-lg font-black text-gray-800">📝 剧本仓库 (Scripts)</h3>
            <span className={`text-sm font-black bg-gray-100 px-2 py-1 rounded ${allScripts.length >= limits.script ? 'text-red-500' : 'text-blue-600'}`}>{allScripts.length} / {limits.script}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {allScripts.map(p => (
              <div key={p.id} onClick={() => openProjectDetails(p)} className="flex justify-between items-center p-4 bg-white hover:bg-blue-50 cursor-pointer rounded-xl border border-gray-200 shadow-sm transition-all group">
                {/* 左侧：标题与状态标签 */}
                <div className="flex flex-col overflow-hidden w-full pr-2">
                  <span className="font-bold text-gray-700 truncate">{p.title}</span>
                  <div className="flex items-center gap-2 mt-1.5">
                    {p.computed_status === 'stitched' && <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-bold border border-green-200">🎬 已成片</span>}
                    {p.computed_status === 'unstitched' && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold border border-orange-200">✂️ 含片段</span>}
                    {p.computed_status === 'draft' && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold border border-gray-200">📝 草稿</span>}
                  </div>
                </div>
                {/* 右侧：操作按钮 */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => handleRename(e, 'video_projects', p.id, p.title)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors">✏️</button>
                  <button onClick={(e) => handleDelete(e, 'project', p.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded-lg transition-colors">🗑️</button>
                </div>
              </div>
            ))}
            {allScripts.length === 0 && <div className="text-center text-gray-400 text-sm mt-10">暂无剧本，请前往【创作剧本】生成</div>}
          </div>
        </div>

        {/* 2. 角色三视图库 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-80 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-50 rounded-bl-full -z-10"></div>
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
            <h3 className="text-lg font-black text-gray-800">👤 角色资产 (Characters)</h3>
            <span className={`text-sm font-black bg-gray-100 px-2 py-1 rounded ${characters.length >= limits.character ? 'text-red-500' : 'text-purple-600'}`}>{characters.length} / {limits.character}</span>
          </div>
          <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-3 pr-2 content-start">
            {characters.map(c => (
              <div key={c.id} onClick={() => openCharacterDetails(c)} className="relative group rounded-xl overflow-hidden border border-gray-200 aspect-square shadow-sm cursor-pointer">
                <img src={getUrl(c.anchor_image_url)} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                  <span className="text-white font-bold text-xs truncate text-center mt-1">{c.name}</span>
                  <div className="flex justify-between gap-1">
                    <button onClick={(e) => handleRename(e, 'characters', c.id, c.name)} className="flex-1 py-1 bg-white/20 hover:bg-white/40 text-white rounded text-[10px] backdrop-blur-sm">改名</button>
                    <button onClick={(e) => handleDelete(e, 'character', c.id)} className="flex-1 py-1 bg-red-500/80 hover:bg-red-500 text-white rounded text-[10px] backdrop-blur-sm">销毁</button>
                  </div>
                </div>
              </div>
            ))}
             {characters.length === 0 && <div className="col-span-3 text-center text-gray-400 text-sm mt-10">暂无角色，请前往【铸造角色】生成</div>}
          </div>
        </div>

        {/* 3. 片段组 (Unstitched) */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-80 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-50 rounded-bl-full -z-10"></div>
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
            <h3 className="text-lg font-black text-gray-800">✂️ 视频片段组 (Snippets)</h3>
            <span className={`text-sm font-black bg-gray-100 px-2 py-1 rounded ${unstitchedProjects.length >= limits.unstitched ? 'text-red-500' : 'text-orange-600'}`}>{unstitchedProjects.length} / {limits.unstitched}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {unstitchedProjects.map(p => (
              <div key={p.id} onClick={() => openProjectDetails(p)} className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl cursor-pointer hover:shadow-md transition-all hover:bg-orange-50 group">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-orange-900 truncate pr-4">{p.title}</span>
                  <button onClick={(e) => handleDelete(e, 'project', p.id)} className="text-xs text-red-500 opacity-0 group-hover:opacity-100 hover:underline px-2 py-1 bg-red-50 rounded">删除项目</button>
                </div>
                <p className="text-xs text-orange-700/70">包含已渲染的散装片段，点击可预览</p>
              </div>
            ))}
            {unstitchedProjects.length === 0 && <div className="text-center text-gray-400 text-sm mt-10">无渲染中的片段</div>}
          </div>
        </div>

        {/* 4. 完整成片库 (Stitched) */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-80 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-green-50 rounded-bl-full -z-10"></div>
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
            <h3 className="text-lg font-black text-gray-800">🎬 终极成片 (Final Video)</h3>
            <span className={`text-sm font-black bg-gray-100 px-2 py-1 rounded ${stitchedProjects.length >= limits.stitched ? 'text-red-500' : 'text-green-600'}`}>{stitchedProjects.length} / {limits.stitched}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {stitchedProjects.map(p => (
              <div key={p.id} className="p-4 bg-green-50 border border-green-200 rounded-xl group relative overflow-hidden shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center gap-2 mb-2 relative z-10">
                  <span className="font-black text-green-900 truncate drop-shadow-md">{p.title}</span>
                  <button onClick={(e) => handleRename(e, 'video_projects', p.id, p.title)} className="p-1.5 text-green-700 hover:text-green-900 hover:bg-green-200/50 rounded transition-colors" title="重命名">✏️</button>
                </div>
                
                <div className="flex gap-2 relative z-10">
                  <button onClick={() => setPreviewMedia({ url: getUrl(p.final_video_url), type: 'video' })} className="text-xs font-bold bg-green-600 text-white px-3 py-1.5 rounded-lg shadow-sm hover:bg-green-500">播放成片</button>
                  <button onClick={(e) => handleDownload(e, getUrl(p.final_video_url), p.title)} className="text-xs font-bold bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg shadow-sm hover:bg-blue-200">💾 下载</button>
                  <button onClick={(e) => handleDelete(e, 'project', p.id)} className="text-xs font-bold bg-white text-red-500 px-3 py-1.5 rounded-lg shadow-sm hover:bg-red-50">销毁</button>
                </div>
                
                {p.final_video_url && <video src={getUrl(p.final_video_url)} className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none mix-blend-overlay" autoPlay loop muted playsInline />}
              </div>
            ))}
            {stitchedProjects.length === 0 && <div className="text-center text-gray-400 text-sm mt-10">尚无合并完成的成片</div>}
          </div>
        </div>

      </div>

      {/* 🌟 剧本与片段详情弹窗 */}
      {viewingProject && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-10 animate-in fade-in">
          <div className="bg-gray-50 w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-white/20">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-white">
              <div>
                <h2 className="text-2xl font-black text-gray-800">📖 {viewingProject.title}</h2>
                <p className="text-xs text-gray-500 mt-1">项目包含的所有镜头资产</p>
              </div>
              <button onClick={() => setViewingProject(null)} className="w-10 h-10 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full text-xl font-bold transition-colors">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {projectScenes.map((scene, index) => {
                 const isLastScene = index === projectScenes.length - 1;
                 return (
                <div key={scene.scene_index} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col lg:flex-row gap-6">
                  {/* 左侧：剧本文案与提示词 */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-blue-600 text-white font-black rounded-lg text-sm">镜头 {scene.scene_index}</span>
                      <span className="text-xs font-black uppercase tracking-widest px-2 py-1 rounded bg-gray-100 text-gray-600 border border-gray-200">🎥 {scene.camera_config?.movement || 'Static'}</span>
                    </div>
                    
                    <p className="text-gray-800 font-medium text-lg leading-relaxed">{scene.raw_script}</p>
                    {scene.dialogue_zh && (
                       <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-blue-800 font-bold text-sm">
                         💬 "{scene.dialogue_zh}"
                       </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-gray-600">▶ 起点设定</span>
                          <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{translateView(scene.start_frame_view)}</span>
                        </div>
                        <div className="text-xs">{renderBilingualPrompt(scene.start_frame_prompt)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 relative">
                         {isLastScene && <div className="absolute top-0 right-0 w-10 h-10 bg-red-50 text-red-500 rotate-45 translate-x-5 -translate-y-5 flex items-end justify-center text-[8px] font-black pb-0.5">结局</div>}
                         <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-gray-600">⏹ {isLastScene ? '结局设定' : '终点设定'}</span>
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${isLastScene ? 'text-red-600 bg-red-50 border-red-100' : 'text-orange-600 bg-orange-50 border-orange-100'}`}>{translateView(scene.end_frame_view)}</span>
                        </div>
                        <div className="text-xs">{renderBilingualPrompt(scene.end_frame_prompt)}</div>
                      </div>
                    </div>
                  </div>

                  {/* 右侧：预览片段视频 */}
                  <div className="w-full lg:w-72 aspect-video bg-black rounded-xl overflow-hidden flex-shrink-0 border-2 border-gray-800 shadow-inner flex items-center justify-center relative group cursor-pointer" onClick={() => scene.video_url && setPreviewMedia({ url: getUrl(scene.video_url), type: 'video' })}>
                    {scene.video_url ? (
                      <>
                        <video src={getUrl(scene.video_url)} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-3xl">▶️</span>
                        </div>
                        <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 text-white text-[10px] font-bold rounded backdrop-blur-md pointer-events-none">已渲染</div>
                      </>
                    ) : (
                      <div className="text-center">
                        <span className="text-3xl mb-2 block opacity-20">🎞️</span>
                        <span className="text-xs text-gray-500 font-bold">尚未渲染片段视频</span>
                      </div>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </div>
        </div>
      )}

      {/* 🌟 角色三视图弹窗 */}
      {viewingCharacter && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-gray-900 w-full max-w-4xl rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden border border-gray-700">
            <div className="p-6 border-b border-gray-800 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-black text-white">👤 {viewingCharacter.name}</h2>
                <p className="text-xs text-gray-400 mt-1">角色多视角锚点数据 (Character Views)</p>
              </div>
              <button onClick={() => setViewingCharacter(null)} className="w-10 h-10 bg-gray-800 hover:bg-gray-700 text-white rounded-full text-xl font-bold transition-colors">&times;</button>
            </div>
            
            <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6 bg-gray-900">
               {['front', 'side', 'back'].map(tag => {
                 const viewData = characterViews.find(v => v.tag === tag);
                 return (
                   <div key={tag} className="flex flex-col gap-3">
                     <div className="flex items-center justify-between">
                       <span className={`text-sm font-black px-3 py-1 rounded-lg ${tag === 'front' ? 'bg-blue-900 text-blue-200' : tag === 'side' ? 'bg-purple-900 text-purple-200' : 'bg-emerald-900 text-emerald-200'}`}>
                         {tag.toUpperCase()} ({translateView(tag)})
                       </span>
                     </div>
                     <div className="aspect-square rounded-2xl bg-gray-800 border-2 border-dashed border-gray-700 flex items-center justify-center overflow-hidden group relative">
                       {viewData?.url ? (
                         <>
                          <img 
                            src={getUrl(viewData.url)} 
                            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-300" 
                            alt={tag} 
                            onClick={() => setPreviewMedia({ url: getUrl(viewData.url), type: 'image' })} 
                          />
                          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                            <span className="text-white bg-black/60 px-3 py-1.5 rounded-lg text-sm font-bold backdrop-blur-sm">🔍 放大</span>
                          </div>
                         </>
                       ) : (
                          <span className="text-gray-600 text-xs font-bold">暂无该视角数据</span>
                       )}
                     </div>
                   </div>
                 )
               })}
            </div>
          </div>
        </div>
      )}

      {/* 🌟 全屏弹窗组件 */}
      {previewMedia && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 lg:p-10 animate-in fade-in duration-200">
          <button 
            onClick={() => setPreviewMedia(null)}
            className="absolute top-6 right-6 z-[110] text-white bg-white/10 hover:bg-white/20 rounded-full w-12 h-12 flex items-center justify-center text-2xl transition-all hover:rotate-90"
          >
            ✕
          </button>
          
          <div className="relative w-full h-full max-w-7xl flex items-center justify-center">
            {previewMedia.type === 'image' ? (
              <img 
                src={previewMedia.url} 
                className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] ring-1 ring-white/10" 
              />
            ) : (
              <video 
                src={previewMedia.url} 
                controls 
                autoPlay 
                className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] ring-1 ring-white/10 bg-black" 
              />
            )}
          </div>
        </div>
      )}

    </div>
  );
}
