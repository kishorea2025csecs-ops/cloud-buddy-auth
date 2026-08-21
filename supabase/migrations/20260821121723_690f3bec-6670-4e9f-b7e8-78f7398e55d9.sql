CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  grade text,
  region text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subjects TO authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subjects readable" ON public.subjects FOR SELECT TO authenticated USING (true);

CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.topics TO authenticated;
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topics readable" ON public.topics FOR SELECT TO authenticated USING (true);

CREATE TABLE public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('foundation','standard','advanced')),
  stage text NOT NULL DEFAULT 'quiz' CHECK (stage IN ('assessment','quiz')),
  prompt text NOT NULL,
  options jsonb NOT NULL,
  correct_index integer NOT NULL,
  explanation text NOT NULL,
  concept text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.questions TO authenticated;
GRANT ALL ON public.questions TO service_role;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questions readable" ON public.questions FOR SELECT TO authenticated USING (true);

CREATE TABLE public.learner_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  self_level text,
  path text,
  knowledge_level text,
  mastery integer NOT NULL DEFAULT 0,
  accuracy integer NOT NULL DEFAULT 0,
  avg_time_ms integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  strengths text[] NOT NULL DEFAULT '{}',
  weaknesses text[] NOT NULL DEFAULT '{}',
  last_stage text NOT NULL DEFAULT 'self_check',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, topic_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_topics TO authenticated;
GRANT ALL ON public.learner_topics TO service_role;
ALTER TABLE public.learner_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own learner_topics" ON public.learner_topics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER learner_topics_updated_at BEFORE UPDATE ON public.learner_topics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'quiz',
  selected_index integer,
  is_correct boolean NOT NULL,
  time_ms integer NOT NULL DEFAULT 0,
  mistake_type text,
  concept text,
  synced_offline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attempts TO authenticated;
GRANT ALL ON public.attempts TO service_role;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own attempts" ON public.attempts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX attempts_user_topic_idx ON public.attempts (user_id, topic_id, created_at DESC);

CREATE TABLE public.ai_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  path text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, topic_id, path)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_lessons TO authenticated;
GRANT ALL ON public.ai_lessons TO service_role;
ALTER TABLE public.ai_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai_lessons" ON public.ai_lessons FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

INSERT INTO public.subjects (slug, name, description, icon) VALUES
  ('mathematics','Mathematics','Numbers, algebra and reasoning','Sigma'),
  ('science','Science','Physics, chemistry and biology basics','FlaskConical'),
  ('english','English','Grammar, comprehension and vocabulary','BookOpen');

INSERT INTO public.topics (subject_id, slug, name, description)
SELECT s.id, t.slug, t.name, t.description FROM public.subjects s
JOIN (VALUES
  ('mathematics','fractions','Fractions','Parts of a whole, comparing and operating on fractions'),
  ('mathematics','linear-equations','Linear Equations','Solving for an unknown in one variable'),
  ('science','photosynthesis','Photosynthesis','How plants make their own food'),
  ('science','force-motion','Force and Motion','Newton''s laws and everyday motion'),
  ('english','tenses','Tenses','Past, present and future forms of verbs'),
  ('english','reading-comprehension','Reading Comprehension','Understanding and interpreting passages')
) AS t(subject_slug, slug, name, description) ON t.subject_slug = s.slug;

INSERT INTO public.questions (topic_id, level, stage, prompt, options, correct_index, explanation, concept)
SELECT tp.id, q.level, q.stage, q.prompt, q.options::jsonb, q.correct_index, q.explanation, q.concept
FROM public.topics tp
JOIN (VALUES
  ('fractions','foundation','assessment','Which fraction is equal to one half?','["2/6","3/6","4/6","5/6"]',1,'3/6 simplifies to 1/2 because 3 and 6 share a factor of 3.','Equivalent fractions'),
  ('fractions','standard','assessment','What is 2/3 + 1/6?','["3/9","5/6","1/2","3/6"]',1,'Convert 2/3 to 4/6, then 4/6 + 1/6 = 5/6.','Adding unlike fractions'),
  ('fractions','advanced','assessment','Simplify (3/4) ÷ (9/8).','["2/3","27/32","1/3","3/2"]',0,'Dividing means multiplying by the reciprocal: 3/4 × 8/9 = 24/36 = 2/3.','Dividing fractions'),
  ('fractions','foundation','quiz','Which is larger: 1/4 or 1/3?','["1/4","1/3","They are equal","Cannot tell"]',1,'With the same numerator, the smaller denominator is the bigger fraction.','Comparing fractions'),
  ('fractions','standard','quiz','What is 5/8 - 1/4?','["3/8","1/2","4/8","1/8"]',0,'1/4 = 2/8, so 5/8 - 2/8 = 3/8.','Subtracting fractions'),
  ('fractions','advanced','quiz','A recipe needs 3/5 of a litre of milk. You have 1 1/4 litres. What fraction of a litre is left?','["13/20","1/2","7/20","3/4"]',0,'1 1/4 = 25/20 and 3/5 = 12/20, so 25/20 - 12/20 = 13/20.','Word problems with fractions'),
  ('linear-equations','foundation','assessment','Solve: x + 7 = 12','["3","5","19","7"]',1,'Subtract 7 from both sides: x = 5.','One-step equations'),
  ('linear-equations','standard','assessment','Solve: 3x - 4 = 11','["5","3","7","15"]',0,'Add 4 to both sides to get 3x = 15, then divide by 3.','Two-step equations'),
  ('linear-equations','advanced','assessment','Solve: 2(x - 3) = 4x + 2','["-4","4","-1","1"]',0,'2x - 6 = 4x + 2 gives -8 = 2x, so x = -4.','Variables on both sides'),
  ('linear-equations','foundation','quiz','Solve: y - 9 = 1','["8","10","-8","9"]',1,'Add 9 to both sides: y = 10.','One-step equations'),
  ('linear-equations','standard','quiz','Solve: (x/2) + 5 = 9','["8","4","2","14"]',0,'x/2 = 4, so x = 8.','Equations with fractions'),
  ('linear-equations','advanced','quiz','The sum of three consecutive integers is 51. What is the smallest?','["16","17","15","18"]',0,'n + (n+1) + (n+2) = 51 gives 3n = 48, n = 16.','Modelling with equations'),
  ('photosynthesis','foundation','assessment','Which gas do plants take in for photosynthesis?','["Oxygen","Carbon dioxide","Nitrogen","Hydrogen"]',1,'Plants absorb carbon dioxide through tiny pores called stomata.','Reactants'),
  ('photosynthesis','standard','assessment','Where in the cell does photosynthesis mainly happen?','["Nucleus","Mitochondria","Chloroplast","Ribosome"]',2,'Chloroplasts contain chlorophyll, which captures light energy.','Cell structures'),
  ('photosynthesis','advanced','assessment','Which statement about the light-dependent reactions is correct?','["They occur in the stroma","They split water to release oxygen","They fix carbon into glucose","They happen only at night"]',1,'Photolysis splits water in the thylakoid membranes, releasing oxygen.','Light reactions'),
  ('photosynthesis','foundation','quiz','What do plants make during photosynthesis?','["Protein","Glucose","Vitamin C","Salt"]',1,'Light energy converts carbon dioxide and water into glucose.','Products'),
  ('photosynthesis','standard','quiz','Which pigment absorbs light for photosynthesis?','["Haemoglobin","Chlorophyll","Melanin","Carotene only"]',1,'Chlorophyll absorbs mostly red and blue light.','Pigments'),
  ('photosynthesis','advanced','quiz','If a plant is kept in blue light only, the rate of photosynthesis is likely to be','["Zero","Lower than white light but not zero","Higher than white light","Unchanged"]',1,'Chlorophyll absorbs blue light well, but fewer wavelengths are available than in white light.','Limiting factors'),
  ('force-motion','foundation','assessment','What is the unit of force?','["Joule","Newton","Watt","Pascal"]',1,'Force is measured in newtons (N).','Units'),
  ('force-motion','standard','assessment','A 2 kg object accelerates at 3 m/s². What force acts on it?','["1.5 N","5 N","6 N","0.67 N"]',2,'F = ma = 2 × 3 = 6 N.','Newton''s second law'),
  ('force-motion','advanced','assessment','A car moves at constant velocity. The net force on it is','["Zero","Equal to its weight","Increasing","Opposite to friction only"]',0,'Constant velocity means balanced forces, so the net force is zero.','Newton''s first law'),
  ('force-motion','foundation','quiz','Friction always acts','["In the direction of motion","Opposite to motion","Upwards","Downwards"]',1,'Friction opposes relative motion between surfaces.','Friction'),
  ('force-motion','standard','quiz','What is the acceleration of a 10 kg box pushed with a net force of 25 N?','["2.5 m/s²","250 m/s²","0.4 m/s²","35 m/s²"]',0,'a = F/m = 25/10 = 2.5 m/s².','Newton''s second law'),
  ('force-motion','advanced','quiz','A rocket pushes gas backwards and moves forward. This is','["Newton''s first law","Newton''s second law","Newton''s third law","Law of gravitation"]',2,'Every action has an equal and opposite reaction.','Newton''s third law'),
  ('tenses','foundation','assessment','Choose the correct form: She ___ to school every day.','["go","goes","going","gone"]',1,'Third person singular in the simple present takes -s.','Simple present'),
  ('tenses','standard','assessment','Choose the correct form: They ___ dinner when I arrived.','["have","were having","has had","will have"]',1,'The past continuous shows an action in progress in the past.','Past continuous'),
  ('tenses','advanced','assessment','Choose the correct form: By next June, he ___ here for ten years.','["will work","will be working","will have worked","works"]',2,'Future perfect describes completion before a future point.','Future perfect'),
  ('tenses','foundation','quiz','Choose the correct form: I ___ my homework yesterday.','["finish","finished","finishing","have finish"]',1,'A finished past action uses the simple past.','Simple past'),
  ('tenses','standard','quiz','Choose the correct form: She ___ in Delhi since 2019.','["lives","lived","has lived","is living"]',2,'"Since" with an ongoing action takes the present perfect.','Present perfect'),
  ('tenses','advanced','quiz','Choose the correct form: If he ___ earlier, he would have caught the bus.','["left","had left","leaves","has left"]',1,'Third conditional uses "had + past participle".','Conditionals'),
  ('reading-comprehension','foundation','assessment','A passage says "Ravi ran quickly to the shop before it closed." Why did Ravi run?','["He was late","He liked running","The shop was far","He was chased"]',0,'"Before it closed" signals time pressure.','Literal meaning'),
  ('reading-comprehension','standard','assessment','What is the main idea of a paragraph?','["The longest sentence","The central point it makes","The first word","A quoted line"]',1,'The main idea is the central point the paragraph supports.','Main idea'),
  ('reading-comprehension','advanced','assessment','"The old bridge groaned under the load." This is an example of','["Simile","Personification","Hyperbole","Alliteration"]',1,'A non-human thing is given a human action.','Figurative language'),
  ('reading-comprehension','foundation','quiz','A synonym for "tired" is','["Sleepy","Angry","Bright","Fast"]',0,'Synonyms have similar meanings.','Vocabulary'),
  ('reading-comprehension','standard','quiz','An author who lists both benefits and risks is most likely trying to','["Persuade","Inform in a balanced way","Entertain","Confuse"]',1,'Presenting both sides indicates a balanced, informative purpose.','Author''s purpose'),
  ('reading-comprehension','advanced','quiz','A writer calls a policy "so-called progress". This word choice suggests','["Approval","Doubt or criticism","Neutrality","Excitement"]',1,'"So-called" signals scepticism about the label.','Tone and inference')
) AS q(topic_slug, level, stage, prompt, options, correct_index, explanation, concept) ON q.topic_slug = tp.slug;