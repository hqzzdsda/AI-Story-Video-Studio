'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export default function MultiviewGenerator() {
  const [userId, setUserId] = useState<string | null>(null);
  
  const [characterList, setCharacterList] = useState<any[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<any>(null);
  
  const [frontView, setFrontView] = useState<string | null>(null);
  const [sideView, setSideView] = useState<string | null>(null);
  const [backView, setBackView] = useState<string | null>(null);

  const [tempSide, setTempSide] = useState<string | null>(null);
  const [tempBack, setTempBack] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingSide, setIsGeneratingSide] = useState(false);
  const [isGeneratingBack, setIsGeneratingBack] = useState(false);
  const [characterName, setCharacterName] = useState('');
  const [basePrompt, setBasePrompt] = useState(''); 

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 🌟 1. 唯一声明展示链接的字典
  const [displayUrls, setDisplayUrls] = useState<Record<string, string>>({});

  // 🌟 2. 解析函数：将私有路径转为 1 小时签名链接
  const resolveUrls = async (paths: (string | null | undefined)[]) => {
    const needsSign = paths.filter((p): p is string => Boolean(p) && !p.startsWith('http') && !p.startsWith('blob:'));
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

  // 🌟 3. 安全读取函数
  const getImgSrc = (path: string | null) => {
    if (!path) return '';
    if (path.startsWith('http') || path.startsWith('blob:')) return path; 
    return displayUrls[path] || ''; 
  };

  useEffect(() => {
    fetchCharacters();
  }, []);

  const fetchCharacters = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
      const { data: chars } = await supabase
        .from('characters')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (chars && chars.length > 0) setCharacterList(chars);
    }
  };

  const handleSelectCharacter = async (char: any) => {
    setActiveCharacter(char);
    setFrontView(char.anchor_image_url);
    setCharacterName(char.name || '');
    setBasePrompt(char.base_description || '');
    
    setTempSide(null);
    setTempBack(null);
    setSideView(null);
    setBackView(null);

    const { data: views } = await supabase
      .from('character_views')
      .select('image_url, view_tag')
      .eq('character_id', char.id);

    const pathsToResolve = [char.anchor_image_url];
    if (views) {
      const side = views.find(v => v.view_tag === 'side');
      const back = views.find(v => v.view_tag === 'back');
      if (side) { setSideView(side.image_url); pathsToResolve.push(side.image_url); }
      if (back) { setBackView(back.image_url); pathsToResolve.push(back.image_url); }
    }
    // 触发解析当前角色的所有图片
    await resolveUrls(pathsToResolve);
  };

  // 🌟 修复：带资进组也必须传到私有保险库 user_assets
  const handleUploadFront = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (file.size > 5 * 1024 * 1024) return alert("图片不能超过 5MB");

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      // 使用严格隔离的私有路径
      const privatePath = `${userId}/custom_front_${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage.from('user_assets').upload(privatePath, file);
      if (uploadError) throw uploadError;

      const { data: newChar, error: charError } = await supabase
        .from('characters')
        .insert({
          name: '未命名角色 (外部导入)',
          base_description: 'A character', 
          anchor_image_url: privatePath, // 存入私有路径
          is_verified: false
        })
        .select().single();
      
      if (charError) throw charError;

      alert("正面图上传并建档成功！");
      await fetchCharacters(); 
      handleSelectCharacter(newChar); 
    } catch (err: any) {
      alert("上传失败: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async (view: 'side' | 'back') => {
    if (!activeCharacter) return alert("请先选择或上传一个角色");
    if (!basePrompt) return alert("请为该角色提供一段基础外貌描述，以便 AI 理解画风！");

    if (view === 'side') setIsGeneratingSide(true);
    else setIsGeneratingBack(true);

    if (view === 'side') setTempSide(null);
    if (view === 'back') setTempBack(null);

    const refs = view === 'side' ? [frontView] : (sideView ? [frontView, sideView] : [frontView]);

    try {
      const { data, error } = await supabase.functions.invoke('step3-multiview', {
        body: { projectId: 'global-studio', userId, basePrompt, targetView: view, referenceImages: refs }
      });

      if (error || data?.error) throw error || new Error(data.error);
      
      // 🌟 修复：新生成的图是私有路径，需要立刻解析才能在预览框显示
      await resolveUrls([data.imageUrl]);

      if (view === 'side') setTempSide(data.imageUrl);
      if (view === 'back') setTempBack(data.imageUrl);
    } catch (err: any) {
      alert(`生成${view === 'side' ? '侧面' : '背面'}失败: ` + err.message);
    } finally {
      if (view === 'side') setIsGeneratingSide(false);
      else setIsGeneratingBack(false);
    }
  };

  const handleSaveView = async (view: 'side' | 'back') => {
    const urlToSave = view === 'side' ? tempSide : tempBack;
    if (!urlToSave || !activeCharacter) return;

    await supabase.from('character_views')
      .delete()
      .eq('character_id', activeCharacter.id)
      .eq('view_tag', view);

    const { error } = await supabase.from('character_views')
      .insert({ character_id: activeCharacter.id, image_url: urlToSave, view_tag: view, is_derived: true });

    if (!error) {
      if (view === 'side') {
        setSideView(urlToSave);
        setTempSide(null);
      } else {
        setBackView(urlToSave);
        setTempBack(null);
      }
    } else {
      alert("保存失败: " + error.message);
    }
  };

  const handleUpdateCharacterMeta = async () => {
    if (!activeCharacter) return;
    const { error } = await supabase.from('characters')
      .update({ name: characterName, base_description: basePrompt, is_verified: true })
      .eq('id', activeCharacter.id);
    
    if (!error) {
      alert("✅ 角色信息已更新！");
      fetchCharacters(); 
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto bg-white rounded-xl shadow-lg mt-8 text-black">
      <div className="flex items-center justify-between border-b pb-6 mb-6">
        <div>
          <h2 className="text-2xl font-black text-gray-800">3. 角色三视图工作台 </h2>
          <p className="text-sm text-gray-500 mt-1">从库中选择、上传或继续补全角色的侧/背面特征</p>
        </div>

        <div className="flex items-center gap-4">
          <select 
            className="p-3 border-2 border-gray-200 rounded-xl bg-gray-50 font-medium outline-none focus:border-purple-500"
            onChange={(e) => {
              const char = characterList.find(c => c.id === e.target.value);
              if (char) handleSelectCharacter(char);
            }}
            value={activeCharacter?.id || ''}
          >
            <option value="" disabled>-- 从数据库选择角色 --</option>
            {characterList.map(c => (
              <option key={c.id} value={c.id}>{c.name} {c.is_verified ? '(完整)' : '(草稿)'}</option>
            ))}
          </select>

          <span className="text-gray-300 font-bold">OR</span>

          <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleUploadFront} />
          <button 
            onClick={() => fileInputRef.current?.click()} disabled={isUploading}
            className="px-5 py-3 bg-purple-100 hover:bg-purple-200 text-purple-700 font-bold rounded-xl transition-colors"
          >
            {isUploading ? '上传中...' : '📤 自己上传正面图'}
          </button>
        </div>
      </div>

      {!activeCharacter ? (
        <div className="py-20 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
           <p className="text-gray-400 font-bold text-lg">请在右上角选择一个角色，或自己上传一张正面图开启工作台</p>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
            <div>
               <label className="block text-xs font-bold text-gray-500 mb-1">角色名称 (调用指令识别名)</label>
               <input type="text" value={characterName} onChange={(e) => setCharacterName(e.target.value)} className="w-full p-2 border rounded-lg" placeholder="例如: 赛博猫咪" />
            </div>
            <div>
               <label className="block text-xs font-bold text-gray-500 mb-1">外貌特征描述 (供 AI 参考)</label>
               <input type="text" value={basePrompt} onChange={(e) => setBasePrompt(e.target.value)} className="w-full p-2 border rounded-lg" placeholder="必须填写，如：银色短发，赛博皮衣..." />
            </div>
            <div className="md:col-span-2">
               <button onClick={handleUpdateCharacterMeta} className="w-full py-2 bg-gray-800 text-white rounded-lg font-bold hover:bg-black text-sm">💾 保存基础信息</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* 1. 正面列 (基准) */}
            <div className="space-y-4 flex flex-col">
              <div className="bg-blue-100 text-blue-800 font-black text-center py-2 rounded-t-xl">FRONT (正面基准)</div>
              <div className="flex-1 bg-gray-50 border-2 border-blue-100 p-2 rounded-b-xl rounded-t-sm">
                 {/* 🌟 修复：套用 getImgSrc */}
                 <img src={getImgSrc(frontView)} alt="Front" className="w-full aspect-square object-cover rounded-lg shadow-sm" />
                 <p className="text-xs text-center text-gray-400 mt-2">无法覆盖，所有推导基于此图</p>
              </div>
            </div>

            {/* 2. 侧面列 */}
            <div className="space-y-4 flex flex-col">
              <div className="bg-purple-100 text-purple-800 font-black text-center py-2 rounded-t-xl">SIDE (侧视图)</div>
              <div className="flex-1 bg-gray-50 border-2 border-purple-100 p-2 rounded-b-xl flex flex-col gap-3">
                 <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-200 border">
                    {tempSide ? (
                      <img src={getImgSrc(tempSide)} className="absolute inset-0 w-full h-full object-cover border-4 border-yellow-400 box-border" />
                    ) : sideView ? (
                      <img src={getImgSrc(sideView)} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">暂无侧面图</div>
                    )}
                    {isGeneratingSide && <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold animate-pulse">正在推导侧面...</div>}
                 </div>

                 {!tempSide ? (
                   <button onClick={() => handleGenerate('side')} disabled={isGeneratingSide} className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 transition-all">
                     {sideView ? '🔄 重新生成并覆盖' : '✨ 推导侧面图'}
                   </button>
                 ) : (
                   <div className="flex gap-2">
                     <button onClick={() => handleSaveView('side')} className="flex-1 py-3 bg-green-500 text-white font-bold rounded-lg shadow-sm">✅ 保存</button>
                     <button onClick={() => setTempSide(null)} className="flex-1 py-3 bg-gray-300 text-gray-800 font-bold rounded-lg shadow-sm">❌ 丢弃</button>
                   </div>
                 )}
              </div>
            </div>

            {/* 3. 背面列 */}
            <div className="space-y-4 flex flex-col">
              <div className="bg-indigo-100 text-indigo-800 font-black text-center py-2 rounded-t-xl">BACK (背视图)</div>
              <div className="flex-1 bg-gray-50 border-2 border-indigo-100 p-2 rounded-b-xl flex flex-col gap-3">
                 <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-200 border">
                    {tempBack ? (
                      <img src={getImgSrc(tempBack)} className="absolute inset-0 w-full h-full object-cover border-4 border-yellow-400 box-border" />
                    ) : backView ? (
                      <img src={getImgSrc(backView)} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">暂无背面图</div>
                    )}
                    {isGeneratingBack && <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold animate-pulse">正在推导背面...</div>}
                 </div>

                 {!tempBack ? (
                   <button onClick={() => handleGenerate('back')} disabled={isGeneratingBack} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 transition-all">
                     {backView ? '🔄 重新生成并覆盖' : '✨ 推导背面图'}
                   </button>
                 ) : (
                   <div className="flex gap-2">
                     <button onClick={() => handleSaveView('back')} className="flex-1 py-3 bg-green-500 text-white font-bold rounded-lg shadow-sm">✅ 保存</button>
                     <button onClick={() => setTempBack(null)} className="flex-1 py-3 bg-gray-300 text-gray-800 font-bold rounded-lg shadow-sm">❌ 丢弃</button>
                   </div>
                 )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}