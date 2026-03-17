'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function Navbar() {
  const [user, setUser] = useState<any>(null);
  const [tier, setTier] = useState<string>('basic');
  const router = useRouter();

  useEffect(() => {
    const getUserData = async () => {
      // 1. 获取 Auth 基础信息
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        // 2. 获取业务表中的等级信息
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('tier')
          .eq('id', user.id)
          .single();
        if (profile) setTier(profile.tier);
      }
    };

    getUserData();

    // 监听登录状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) router.push('/auth');
    });

    return () => subscription.unsubscribe();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/auth');
  };

  if (!user) return null; // 未登录时不显示导航条

  return (
    <nav className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* 左侧：Logo 和 品牌名 */}
        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => router.push('/')}>
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-200">
            <span className="text-white font-black text-xl">V</span>
          </div>
          <span className="font-black text-xl tracking-tighter text-gray-900">AI VIDEO</span>
        </div>
      
        {/* 右侧：用户信息与操作 */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            {/* 会员等级勋章 */}
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
              tier === 'pro' 
              ? 'bg-purple-100 text-purple-600 border border-purple-200' 
              : 'bg-gray-100 text-gray-500 border border-gray-200'
            }`}>
              {tier}
            </span>
            
            {/* 🌟 修改这里：把用户信息变成可以点击的按钮 */}
            <div 
              onClick={() => router.push('/profile')}
              className="text-right hidden sm:block cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors border border-transparent hover:border-gray-100"
              title="前往个人中心"
            >
              <p className="text-xs font-medium text-gray-900 leading-none">{user.email}</p>
              <p className="text-[10px] text-blue-500 mt-1 font-bold">⚙️ 设置 / 切换套餐</p>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="h-6 w-[1px] bg-gray-200"></div>


          {/* 登出按钮 */}
          <button 
            onClick={handleLogout}
            className="text-sm font-bold text-gray-400 hover:text-red-500 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}