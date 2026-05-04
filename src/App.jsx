import profilePhoto from './assets/me.png'
import hleImage from './assets/hle.png'
import archeryImage from './assets/archery.png'
import viewershipImage from './assets/viewership.png'

const research = [
  {
    title: 'Probing the limits of frontier AI: a benchmark of expert-level scientific questions',
    authors: 'Center for AI Safety, Scale AI & HLE Contributors Consortium (incl. Maxwell Shepherd)',
    venue: <em>Nature</em>,
    href: 'https://www.nature.com/articles/s41586-025-09962-4',
    description:
      'A benchmark assessing frontier model performance on expert-level academic questions across the sciences and humanities.',
    image: hleImage,
    imageAlt: "Humanity's Last Exam",
  },
  {
    title: 'Frozen Vision Transformers for Dense Prediction on Small Datasets: A Case Study in Arrow Localization',
    authors: 'Maxwell Shepherd',
    venue: 'arXiv:2604.16758, 2026',
    href: 'https://arxiv.org/abs/2604.16758',
    description:
      'A pipeline that combines color-based rectification with a frozen self-supervised vision transformer and feature upsampling to detect, localize, and score arrow punctures on indoor archery faces from only 48 annotated photographs.',
    image: archeryImage,
    imageAlt: 'Arrow localization on archery face',
  },
  {
    title: 'Concurrent Streaming, Viewer Transfers, and Audience Loyalty in a Creator Ecosystem: A Minute-Level Longitudinal Study',
    authors: 'Maxwell Shepherd',
    venue: 'arXiv:2603.23773, 2026',
    href: 'https://arxiv.org/abs/2603.23773',
    description:
      'A minute-level longitudinal study of overlapping live-streaming audiences, characterizing concurrent streaming, viewer transfers, and audience loyalty within a creator ecosystem.',
    image: viewershipImage,
    imageAlt: 'Concurrent streaming viewership',
  },
]

function App() {
  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-[42rem] mx-auto px-4 pb-16 pt-10 sm:pb-20 sm:pt-14 space-y-12">
        <section className="text-[1.0625rem] leading-relaxed [&>p+p]:mt-4">
          <img
            src={profilePhoto}
            alt="Maxwell Shepherd"
            className="float-right ml-6 mb-2 w-[205px] sm:w-[237px] h-auto rounded-md object-cover shadow-md"
          />
          <h1 className="text-5xl leading-tight tracking-tight font-normal">
            <span className="font-bold">Maxwell</span> Shepherd
          </h1>
          <p className="mt-3 text-lg text-blue-600">
            Data Scientist &middot; Industrial Engineer
          </p>
          <p className="mt-2 mb-6 text-sm text-gray-500">
            Boeing &middot; Johns Hopkins &middot;{' '}
            <span>mshep0306 [at] gmail [dot] com</span>
          </p>
          <p className="mt-4">
            I'm a Data Scientist and Industrial Engineer with an M.S. in Data Science
            from Johns Hopkins University, specializing in machine learning and artificial
            intelligence.
          </p>
          <p>
            At Boeing, I serve as an Industrial Engineer and Data Scientist lead, heading
            cross-functional teams that build end-to-end machine learning solutions
            across multi-terabyte datasets. As a{' '}
            <span className="font-medium text-gray-900">
              Boeing Designated Expert in Analytics
            </span>
            , I'm recognized as an enterprise-wide authority on ML, GenAI, and applied
            statistics, and help set the technical direction for machine learning and
            agentic AI across an organization of 2,000+.
          </p>
          <p>
            Much of my recent work focuses on bringing modern ML and agentic AI into
            production. I design LLM-powered automation, integrate AI-agent systems
            into core workflows, and guide their rollout across teams. This sits
            alongside broader data lifecycle work, including architecting ETL
            pipelines processing 450M+ rows daily and building full-stack web
            applications that put models and analyses directly in users' hands.
            The ability for a data scientist to operationalize their own work as
            shippable tools, rather than handing off a static report, is one of the
            most valuable skills in the field.
          </p>
          <p>
            Before my current role, I supported process optimization and data automation
            across Boeing's 747, 767, 777X, and 787 programs, and held engineering
            internships at Disney and PTC&nbsp;Inc. I graduated from Purdue University
            in 2020 with a B.S. in Industrial Engineering.
          </p>
          <p>
            For more on my technical skills and experience, see my{' '}
            <a
              href="/resume-784acda1c09a1b7d.pdf"
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-bold underline decoration-blue-300 text-blue-600 hover:text-blue-700"
            >
              resume
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Selected Research</h2>
          <div className="space-y-6">
            {research.map((item) => (
              <article key={item.href} className="flex gap-4">
                <img
                  src={item.image}
                  alt={item.imageAlt}
                  className="w-20 sm:w-24 h-20 sm:h-24 flex-shrink-0 rounded-md object-cover shadow-md"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[1.05rem]">
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold leading-snug hover:underline underline-offset-2"
                    >
                      {item.title}
                    </a>
                  </div>
                  <p className="mt-1 text-sm">{item.authors}</p>
                  <p className="mt-0.5 text-sm text-gray-500 italic">{item.venue}</p>
                  <p className="mt-2 text-[0.95rem] leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
