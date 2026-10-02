import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityComponent } from 'expo-widgets';

export interface Scoreline {
  us: string;
  them: string;
  games: string;
  sets: string;
  winner: string;
}

const ScoreActivity: LiveActivityComponent<Scoreline> = (score) => {
  'widget';
  const ball = '#d7f23c';
  const muted = '#8fa3c9';
  const big = font({ size: 34, weight: 'heavy', design: 'rounded' });
  const compact = font({ weight: 'bold', design: 'rounded' });
  return {
    banner: (
      <HStack modifiers={[padding({ all: 16 })]}>
        <VStack>
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(muted)]}>
            {score.winner ? `${score.winner} win` : `Sets ${score.sets}  Games ${score.games}`}
          </Text>
          <Text modifiers={[big]}>{`Us ${score.us} - ${score.them} Them`}</Text>
        </VStack>
        <Spacer />
      </HStack>
    ),
    compactLeading: <Text modifiers={[compact, foregroundStyle(ball)]}>{score.us}</Text>,
    compactTrailing: <Text modifiers={[compact]}>{score.them}</Text>,
    minimal: <Text modifiers={[compact, foregroundStyle(ball)]}>{score.us}</Text>,
    expandedLeading: (
      <Text
        modifiers={[font({ size: 28, weight: 'heavy', design: 'rounded' }), foregroundStyle(ball)]}
      >
        {`Us ${score.us}`}
      </Text>
    ),
    expandedTrailing: (
      <Text modifiers={[font({ size: 28, weight: 'heavy', design: 'rounded' })]}>
        {`${score.them} Them`}
      </Text>
    ),
    expandedBottom: (
      <Text modifiers={[font({ size: 14 }), foregroundStyle(muted)]}>
        {`Sets ${score.sets}   Games ${score.games}`}
      </Text>
    ),
  };
};

export const scoreActivity = createLiveActivity<Scoreline>('PadelScore', ScoreActivity);
