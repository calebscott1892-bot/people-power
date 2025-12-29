import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Zap, ArrowRight } from 'lucide-react';
import { Button } from "@/components/ui/button";

export default function IntroScreen({ onContinue, isExiting: _isExiting }) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 1.2, ease: "easeInOut" }}
        className="fixed inset-0 z-[9999] bg-gradient-to-br from-slate-900 via-[#1a1d4d] to-slate-900 overflow-y-auto"
      >
        {/* Animated Background Circles */}
        <motion.div
          animate={
            reduceMotion
              ? { scale: 1, opacity: 0.12 }
              : {
                  scale: [1, 1.2, 1],
                  opacity: [0.1, 0.2, 0.1],
                }
          }
          transition={reduceMotion ? { duration: 0 } : { duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute w-[800px] h-[800px] rounded-full bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF] blur-3xl"
          style={{ top: '10%', right: '-10%' }}
        />
        <motion.div
          animate={
            reduceMotion
              ? { scale: 1, opacity: 0.18 }
              : {
                  scale: [1, 1.3, 1],
                  opacity: [0.15, 0.25, 0.15],
                }
          }
          transition={reduceMotion ? { duration: 0 } : { duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute w-[600px] h-[600px] rounded-full bg-gradient-to-r from-[#FFC947] to-[#FFD666] blur-3xl"
          style={{ bottom: '10%', left: '-5%' }}
        />
        
        {/* Content Container */}
        <div className="relative max-w-4xl mx-auto min-h-screen flex flex-col justify-center py-12 px-6">
          {/* Logo */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: 1, bounce: 0.5 }}
            className="flex justify-center mb-8"
          >
            <div className="relative">
              <motion.div
                animate={
                  reduceMotion
                    ? { boxShadow: "0 0 40px rgba(58, 61, 255, 0.4)" }
                    : {
                        boxShadow: [
                          "0 0 40px rgba(58, 61, 255, 0.4)",
                          "0 0 80px rgba(58, 61, 255, 0.6)",
                          "0 0 40px rgba(58, 61, 255, 0.4)",
                        ],
                      }
                }
                transition={reduceMotion ? { duration: 0 } : { duration: 3, repeat: Infinity }}
                className="w-24 h-24 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-3xl flex items-center justify-center"
              >
                <Zap className="w-14 h-14 text-[#FFC947]" fill="#FFC947" strokeWidth={3} />
              </motion.div>
            </div>
          </motion.div>

          {/* Main Title */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.3, duration: reduceMotion ? 0 : 0.8 }}
            className="text-center mb-12"
          >
            <h1 className="text-6xl sm:text-7xl font-black text-white mb-4 tracking-tight leading-none">
              PEOPLE
            </h1>
            <h1 className="text-6xl sm:text-7xl font-black bg-gradient-to-r from-[#FFC947] to-[#FFD666] bg-clip-text text-transparent mb-6 tracking-tight leading-none">
              POWER
            </h1>
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: reduceMotion ? 0 : 0.8, duration: reduceMotion ? 0 : 0.6 }}
              className="h-1 w-32 bg-gradient-to-r from-[#3A3DFF] to-[#FFC947] mx-auto rounded-full"
            />
          </motion.div>

          {/* Mission Text */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.6, duration: reduceMotion ? 0 : 0.8 }}
            className="space-y-6 text-center text-slate-200 text-lg sm:text-xl leading-relaxed max-w-3xl mx-auto mb-12"
          >
            <p className="font-semibold">
              People Power exists because <span className="text-[#FFC947] font-bold">ordinary people are extraordinary</span> when they come together.
            </p>
            
            <p>
              Most humans want good. Most people want to help. Not everyone has money to give — but everyone has <span className="text-white font-bold">time, voice, and effort</span> that can change the world.
            </p>
            
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduceMotion ? 0 : 1.2, duration: reduceMotion ? 0 : undefined }}
              className="py-6"
            >
              <p className="text-2xl font-black text-white mb-4">
                This platform is built on a simple belief:
              </p>
              <p className="text-xl">
                When everyday people unite around a shared purpose, they become <span className="text-[#3A3DFF] font-black text-2xl">the most powerful force on Earth</span> — stronger than any government, stronger than any single institution.
              </p>
            </motion.div>
            
            <p className="text-xl font-semibold">
              Here, your actions — small or large — combine with others to create <span className="text-[#FFC947] font-bold">real, measurable impact</span>.
            </p>
            
            <p className="text-2xl font-bold text-white">
              You&apos;re not just watching change happen.<br />
              <span className="text-[#FFC947]">You are part of it.</span>
            </p>
          </motion.div>

          {/* Bottom Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 1.5, duration: reduceMotion ? 0 : 0.8 }}
            className="text-center"
          >
            <div className="mb-8">
              <p className="text-3xl font-black text-white mb-2">
                Welcome to People Power.
              </p>
              <p className="text-xl font-bold text-slate-300 uppercase tracking-wider">
                Unite • Act • Transform
              </p>
            </div>

            <motion.div
              whileHover={reduceMotion ? undefined : { scale: 1.05 }}
              whileTap={reduceMotion ? undefined : { scale: 0.95 }}
            >
              <Button
                onClick={onContinue}
                className="h-16 px-12 bg-gradient-to-r from-[#FFC947] to-[#FFD666] hover:from-[#FFD666] hover:to-[#FFC947] text-slate-900 rounded-2xl font-black text-xl shadow-2xl shadow-yellow-400/40 uppercase tracking-wider"
              >
                Continue
                <ArrowRight className="w-6 h-6 ml-2" strokeWidth={3} />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}